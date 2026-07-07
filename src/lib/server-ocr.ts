// Server-side OCR for large scanned PDFs (> MAX_CLIENT_OCR_PAGES pages).
//
// OCR-ing hundreds of pages in the browser would pin a phone's CPU for an
// hour, so big scans go to Supabase instead, mirroring the mobile Links upload
// flow (gandd-mobile/lib/links-client.ts): upload the REAL bytes to the
// `documents` storage bucket (unlike normal web uploads, which are text-only),
// insert a `documents` row with extract_status "pending", then call the
// `ocr-enqueue` edge function.
//
// Edge functions get ~150 s of wall clock, so one invocation can never OCR a
// whole book. ocr-enqueue splits the document into small page-range jobs
// (ocr_jobs table) and each `ocr-worker` invocation claims + processes exactly
// ONE job (atomic claim via FOR UPDATE SKIP LOCKED, so concurrent invocations
// never double-process). The queue drains two ways, whichever fires first:
//   - pg_cron pokes ocr-worker every minute (if the extension is enabled), and
//   - driveServerOcr() below pokes the worker in a loop while it polls the
//     documents row for progress, so an open tab drains the queue at full
//     speed instead of one job per minute.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const ENQUEUE_URL = `${SUPABASE_URL}/functions/v1/ocr-enqueue`;
const WORKER_URL = `${SUPABASE_URL}/functions/v1/ocr-worker`;

// The `documents` bucket rejects objects over Supabase's default 50 MB limit,
// and the edge functions must hold the whole file in memory to parse it
// (256 MB isolate). Reject early with an actionable message instead of letting
// the storage upload fail with an opaque 413.
export const SERVER_OCR_MAX_BYTES = 50 * 1024 * 1024;

// How long driveServerOcr babysits before handing off to the background. This
// is NOT a failure cap - pg_cron (when enabled) keeps draining the queue after
// we stop watching, so timing out means "still working", not "failed".
const DRIVE_TIMEOUT_MS = 30 * 60_000;
// Poll cadence while another driver (cron / second tab) owns the queue.
const POLL_BASE_MS = 4_000;
const POLL_MAX_MS = 20_000;
// If nothing claims a job AND page progress is frozen for this long, the
// worker is crashing before it can even record an attempt - stop looping.
const STALL_LIMIT_MS = 8 * 60_000;

export type ServerOcrProgress = {
  pagesDone: number;
  pagesTotal: number | null;
};

export type ServerOcrOutcome =
  | { status: "ready" }
  | { status: "error"; error: string }
  // Babysitting budget ran out; the queue may still drain via pg_cron.
  | { status: "background" };

async function authHeaders(): Promise<Record<string, string>> {
  // Same token dance as chat-client.ts: prefer the user's JWT (RLS + edge
  // functions identify the caller from it), fall back to the publishable key.
  let token = SUPABASE_PUBLISHABLE_KEY;
  try {
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? SUPABASE_PUBLISHABLE_KEY;
  } catch {
    token = SUPABASE_PUBLISHABLE_KEY;
  }
  return {
    "Content-Type": "application/json",
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Uploads the PDF bytes, records the documents row, and asks ocr-enqueue to
 * split it into page-range jobs. Resolves as soon as the queue exists - actual
 * OCR happens asynchronously (see driveServerOcr). Throws with a user-facing
 * message on any failure, cleaning up the partial upload where possible.
 */
export async function enqueueServerOcr(
  file: File,
  userId: string,
): Promise<{ documentId: string }> {
  if (file.size > SERVER_OCR_MAX_BYTES) {
    throw new Error(
      `This scanned PDF is ${(file.size / 1024 / 1024).toFixed(0)} MB - over the 50 MB server limit. Split it into smaller parts (most PDF apps can print/export a page range) and upload those instead.`,
    );
  }

  const safeName = file.name.replace(/[^\w.\-]+/g, "_") || "document.pdf";
  const storagePath = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}-${safeName}`;

  const { error: upErr } = await supabase.storage
    .from("documents")
    .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
  if (upErr) {
    throw new Error(`Upload failed: ${upErr.message}`);
  }

  const { data: inserted, error: insErr } = await supabase
    .from("documents")
    .insert({
      // documents.user_id is NOT NULL and gated by an RLS insert policy
      // (auth.uid() = user_id) - omitting it rejects the row.
      user_id: userId,
      file_name: file.name,
      storage_path: storagePath,
      file_type: "pdf",
      file_size: file.size,
      extract_status: "pending",
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    // Clean up the orphaned upload so storage doesn't drift from the table.
    await supabase.storage.from("documents").remove([storagePath]);
    throw new Error(`Could not save "${file.name}": ${insErr?.message ?? "insert failed"}`);
  }

  try {
    const resp = await fetch(ENQUEUE_URL, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ documentId: inserted.id }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || body.error) {
      throw new Error(body.error || `Could not start server OCR (HTTP ${resp.status}).`);
    }
  } catch (err) {
    // Mark the row so the failure is visible in the library rather than the
    // document sitting at "pending" forever; the user can delete + retry.
    const message = err instanceof Error ? err.message : "Could not start server OCR.";
    await supabase
      .from("documents")
      .update({ extract_status: "error", extract_error: message })
      .eq("id", inserted.id);
    throw new Error(message);
  }

  return { documentId: inserted.id };
}

/**
 * Drives the OCR queue for one document until it's ready, fails, or the
 * babysitting budget runs out. Each loop pokes ocr-worker once (the worker is
 * a fast no-op when the queue is empty), then reads progress off the documents
 * row. Poking sequentially - not just polling - matters when pg_cron isn't
 * enabled: without it nothing else would run the workers at all.
 */
export async function driveServerOcr(
  documentId: string,
  onProgress?: (progress: ServerOcrProgress) => void,
): Promise<ServerOcrOutcome> {
  const startedAt = Date.now();
  let lastProgressAt = Date.now();
  let lastPagesDone = -1;
  let idlePolls = 0;

  while (Date.now() - startedAt < DRIVE_TIMEOUT_MS) {
    // 1. Poke the worker. Transient network failures are fine - the next loop
    //    (or pg_cron) picks up where this one left off.
    let claimed = false;
    try {
      const resp = await fetch(WORKER_URL, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ documentId }),
      });
      const body = await resp.json().catch(() => ({}));
      claimed = body.claimed === true;
    } catch {
      // ignore; treated as an idle poll below
    }

    // 2. Read progress. The worker updates ocr_pages_done after every job.
    const { data: doc } = await supabase
      .from("documents")
      .select("extract_status, extract_error, ocr_pages_done, ocr_pages_total")
      .eq("id", documentId)
      .single();

    if (doc) {
      const pagesDone = doc.ocr_pages_done ?? 0;
      onProgress?.({ pagesDone, pagesTotal: doc.ocr_pages_total ?? null });
      if (pagesDone !== lastPagesDone) {
        lastPagesDone = pagesDone;
        lastProgressAt = Date.now();
      }
      if (doc.extract_status === "ready") return { status: "ready" };
      if (doc.extract_status === "error" || doc.extract_status === "rejected") {
        return {
          status: "error",
          error: doc.extract_error || "Server OCR failed. Delete the document and try again.",
        };
      }
    }

    if (claimed) {
      // A job just finished - immediately claim the next one so an open tab
      // drains the queue at full speed. No sleep.
      idlePolls = 0;
      continue;
    }

    // Nothing claimed: either another driver owns the queue (fine - watch its
    // progress) or the worker is dying before it can record anything (stall).
    if (Date.now() - lastProgressAt > STALL_LIMIT_MS) {
      return {
        status: "error",
        error:
          "Server OCR stalled - no progress for several minutes. Please delete the document and try again, or split the PDF into smaller parts.",
      };
    }
    idlePolls += 1;
    const wait = Math.min(POLL_MAX_MS, POLL_BASE_MS * Math.max(1, idlePolls));
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return { status: "background" };
}
