// Server-side OCR for large scanned PDFs (> MAX_CLIENT_OCR_PAGES pages), up to
// ~200 MB whole-document.
//
// OCR-ing hundreds of pages in the browser would pin a phone's CPU for an hour,
// so big scans go to Supabase instead. But a 200 MB book can't be one storage
// object (the bucket caps objects at 50 MB) and can't be re-downloaded whole by
// every worker (256 MB isolate; 160 jobs x 200 MB = ~32 GB of egress). So we
// SPLIT the PDF into <=50 MB parts right here in the browser (which has GBs of
// headroom), upload each part, insert a `documents` row (its storage_path is the
// parts FOLDER) with extract_status "pending", then hand ocr-enqueue a manifest
// of {part path, page range}. Each ocr-worker later downloads only its OWN part.
//
// Edge functions get ~150 s of wall clock, so one invocation can never OCR a
// whole book. ocr-enqueue turns the manifest into small page-range jobs
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

// Whole-document ceiling for server OCR. We no longer upload the book as one
// object - it's split into <=PART_TARGET_BYTES parts right here in the browser
// (which has GBs of headroom), so this cap is about total OCR work/time, NOT
// about any single object or edge-function isolate. Full scanned textbooks land
// around 200 MB at 300 DPI.
export const SERVER_OCR_MAX_BYTES = 200 * 1024 * 1024;

// Each uploaded PART must stay under the `documents` bucket's 50 MB per-object
// limit. Target 40 MB with an 8 MB safety margin: PDF `save()` output isn't
// perfectly predictable, so we verify each saved part and shrink its page span
// if it overshoots PART_HARD_BYTES (see splitScannedPdf).
const PART_TARGET_BYTES = 40 * 1024 * 1024;
const PART_HARD_BYTES = 48 * 1024 * 1024;

// A single page whose own bytes exceed the object limit can't be uploaded as a
// part at all (e.g. a 600 DPI lossless full-bleed scan). Rare, but surface it
// clearly instead of failing later with an opaque storage 413.
const MAX_SINGLE_PAGE_BYTES = 49 * 1024 * 1024;

type PdfPart = {
  storagePath: string;
  // ABSOLUTE document page number of this part's first page (1-based).
  firstPage: number;
  pageCount: number;
};

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
 * Splits a scanned PDF into <=PART_HARD_BYTES parts entirely in the browser,
 * using pdf-lib. Returns the raw bytes of each part plus the ABSOLUTE page range
 * it covers, so ocr-enqueue can build page-range jobs against the parts without
 * ever downloading or parsing the whole book on the server.
 *
 * Scanned PDFs split cleanly - each page is a self-contained full-page image
 * with no shared fonts/resources - so a part's byte size tracks its page span.
 * We seed the span from the average page size, then verify each saved part and
 * shrink it if it overshoots (blank vs. dense pages vary a lot).
 */
async function splitScannedPdf(file: File): Promise<{
  pageCount: number;
  parts: { bytes: Uint8Array; firstPage: number; pageCount: number }[];
}> {
  // Lazy-import: only this rare large-scan path pays for pdf-lib.
  const { PDFDocument } = await import("pdf-lib");
  const srcBytes = new Uint8Array(await file.arrayBuffer());

  let src: import("pdf-lib").PDFDocument;
  try {
    src = await PDFDocument.load(srcBytes, { ignoreEncryption: true });
  } catch {
    throw new Error(
      "Could not open this PDF to prepare it for server OCR. Open it once in a PDF reader and save a fresh copy, then try again.",
    );
  }

  const pageCount = src.getPageCount();
  if (pageCount === 0) throw new Error("This PDF has no pages to OCR.");

  const avgBytesPerPage = Math.max(1, srcBytes.length / pageCount);
  const estPagesPerPart = Math.max(1, Math.floor(PART_TARGET_BYTES / avgBytesPerPage));

  const parts: { bytes: Uint8Array; firstPage: number; pageCount: number }[] = [];
  let cursor = 0; // 0-based page index into src
  while (cursor < pageCount) {
    let take = Math.min(estPagesPerPart, pageCount - cursor);
    let bytes: Uint8Array;
    // Build the candidate part, shrinking its span until it fits the bucket's
    // per-object limit (or it's a single page and can't shrink further).
    for (;;) {
      const part = await PDFDocument.create();
      const indices = Array.from({ length: take }, (_, i) => cursor + i);
      const copied = await part.copyPages(src, indices);
      copied.forEach((p) => part.addPage(p));
      bytes = await part.save();
      if (bytes.length <= PART_HARD_BYTES || take === 1) break;
      // Overshot: use the observed density to pick a smaller span (and always
      // drop at least one page so this can't spin).
      const ratio = PART_TARGET_BYTES / bytes.length;
      take = Math.max(1, Math.min(take - 1, Math.floor(take * ratio)));
    }
    if (take === 1 && bytes.length > MAX_SINGLE_PAGE_BYTES) {
      throw new Error(
        `Page ${cursor + 1} of this scan is ${(bytes.length / 1024 / 1024).toFixed(0)} MB on its own - too large for server OCR. Re-scan or re-export at a lower resolution (150-200 DPI is plenty for text).`,
      );
    }
    parts.push({ bytes, firstPage: cursor + 1, pageCount: take });
    cursor += take;
  }

  return { pageCount, parts };
}

/**
 * Splits the scanned PDF into <=50 MB parts, uploads each, records the documents
 * row, and asks ocr-enqueue to build page-range jobs against those parts.
 * Resolves as soon as the queue exists - actual OCR happens asynchronously (see
 * driveServerOcr). Throws with a user-facing message on any failure, cleaning up
 * whatever it already uploaded.
 */
export async function enqueueServerOcr(
  file: File,
  userId: string,
): Promise<{ documentId: string }> {
  if (file.size > SERVER_OCR_MAX_BYTES) {
    throw new Error(
      `This scanned PDF is ${(file.size / 1024 / 1024).toFixed(0)} MB - over the ${Math.round(
        SERVER_OCR_MAX_BYTES / 1024 / 1024,
      )} MB limit for server OCR. Split it into smaller files (most PDF apps can print/export a page range) and upload those instead.`,
    );
  }

  const { pageCount, parts } = await splitScannedPdf(file);

  // All parts for one document live under a single folder so delete can wipe
  // them in one list+remove. storage_path on the documents row points at this
  // FOLDER (not a single object) - see onDelete in the Library page.
  const folder = `serverocr/${userId}/${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const uploaded: string[] = [];

  try {
    const manifest: PdfPart[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const storagePath = `${folder}/part-${String(i).padStart(3, "0")}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        // Uint8Array is a valid BlobPart at runtime; the cast placates the DOM
        // lib's SharedArrayBuffer-union typing for TypedArray buffers.
        .upload(storagePath, new Blob([part.bytes as BlobPart], { type: "application/pdf" }), {
          contentType: "application/pdf",
          upsert: false,
        });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      uploaded.push(storagePath);
      manifest.push({ storagePath, firstPage: part.firstPage, pageCount: part.pageCount });
    }

    const { data: inserted, error: insErr } = await supabase
      .from("documents")
      .insert({
        // documents.user_id is NOT NULL and gated by an RLS insert policy
        // (auth.uid() = user_id) - omitting it rejects the row.
        user_id: userId,
        file_name: file.name,
        storage_path: folder,
        file_type: "pdf",
        file_size: file.size,
        extract_status: "pending",
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      throw new Error(`Could not save "${file.name}": ${insErr?.message ?? "insert failed"}`);
    }

    try {
      const resp = await fetch(ENQUEUE_URL, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ documentId: inserted.id, pageCount, parts: manifest }),
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
  } catch (err) {
    // Clean up any parts we already uploaded so storage doesn't drift from the
    // table. (The documents row, if inserted, is left with an error status for
    // the user to see and delete; its folder is already emptied here.)
    if (uploaded.length) {
      await supabase.storage
        .from("documents")
        .remove(uploaded)
        .catch(() => {});
    }
    throw err instanceof Error ? err : new Error("Could not start server OCR.");
  }
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
