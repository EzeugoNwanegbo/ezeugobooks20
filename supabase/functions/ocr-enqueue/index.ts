// G&D - OCR dispatcher for large scanned PDFs (web Library, > 50 pages).
//
// The web app OCRs small scans in the browser (src/lib/pdf.ts); big ones come
// here. This function does NO OCR and - as of the part-split rework - NO file
// download or PDF parsing either. The web client already:
//   1. split the scanned PDF into <=50 MB parts and uploaded each (the bucket
//      caps objects at 50 MB, and no isolate can hold a 200 MB book), and
//   2. knows the page count from its own pdf.js parse (the only reason a file
//      reaches this queue is that pdf.js found ZERO text layer),
// so it hands us a manifest of {part storage path, absolute page range}. All we
// do is turn that into small page-range jobs (ocr_jobs) that each fit inside one
// ocr-worker invocation, mark the document 'processing', and return.
//
// The queue then drains via pg_cron and/or the web client poking ocr-worker
// (see supabase/migrations/20260706120000_add_ocr_jobs.sql for the design).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pages per job. Each ocr-worker invocation downloads + parses ONE part file
// and OCRs this many pages (~2-8 s of wasm OCR per page), so the batch must stay
// well inside the worker's ~150 s wall-clock budget. Overridable per-project
// without a redeploy via the OCR_JOB_PAGES function secret.
const JOB_PAGES = Math.max(1, Number(Deno.env.get("OCR_JOB_PAGES") ?? "5") || 5);

// Whole-document byte ceiling, mirrored from SERVER_OCR_MAX_BYTES in
// src/lib/server-ocr.ts. Defence in depth only - this function never holds the
// file, and no single uploaded part exceeds the bucket's 50 MB limit. Full
// scanned textbooks land around 200 MB at 300 DPI.
const MAX_OCR_BYTES = Math.max(1, Number(Deno.env.get("OCR_MAX_BYTES") ?? "") || 200 * 1024 * 1024);

// OCR takes seconds per page even on the server; past this the queue would take
// hours and the user is better served splitting the file. Raised for full
// textbooks; overridable via OCR_MAX_PAGES.
const MAX_OCR_PAGES = Math.max(1, Number(Deno.env.get("OCR_MAX_PAGES") ?? "") || 1500);

type PartManifest = { storagePath: string; firstPage: number; pageCount: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing authorization." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Identify the caller from their JWT, then scope every query to their id.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Invalid session." }, 401);

    const { documentId, parts } = (await req.json()) as {
      documentId?: string;
      parts?: PartManifest[];
    };
    if (!documentId) return json({ error: "documentId is required." }, 400);
    if (!Array.isArray(parts) || parts.length === 0) {
      return json({ error: "parts manifest is required." }, 400);
    }

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select("id, user_id, file_name, file_size, storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();
    if (docErr || !doc) return json({ error: "Document not found." }, 404);

    const fail = async (status: string, message: string, httpStatus: number) => {
      await admin
        .from("documents")
        .update({ extract_status: status, extract_error: message })
        .eq("id", doc.id);
      return json({ status, error: message }, httpStatus);
    };

    if (typeof doc.file_size === "number" && doc.file_size > MAX_OCR_BYTES) {
      return await fail(
        "rejected",
        `This file is ${Math.round(doc.file_size / 1024 / 1024)} MB - over the ${Math.round(
          MAX_OCR_BYTES / 1024 / 1024,
        )} MB server OCR limit. Split it into smaller files and upload those instead.`,
        200,
      );
    }

    // Validate the manifest. Crucially, every part path must live under THIS
    // user's own server-OCR prefix: the workers download job.storage_path with
    // the service role (which bypasses RLS), so an unchecked path would let a
    // caller OCR someone else's private object into their own document.
    const prefix = `serverocr/${user.id}/`;
    let pageCount = 0;
    for (const part of parts) {
      if (
        !part ||
        typeof part.storagePath !== "string" ||
        !part.storagePath.startsWith(prefix) ||
        !Number.isInteger(part.firstPage) ||
        part.firstPage < 1 ||
        !Number.isInteger(part.pageCount) ||
        part.pageCount < 1
      ) {
        return await fail("error", "Invalid OCR manifest. Please delete the document and try again.", 400);
      }
      pageCount = Math.max(pageCount, part.firstPage + part.pageCount - 1);
    }

    if (pageCount > MAX_OCR_PAGES) {
      return await fail(
        "rejected",
        `This PDF has ${pageCount} pages - over the ${MAX_OCR_PAGES}-page OCR limit. Split it into smaller files.`,
        200,
      );
    }

    // Reset any previous queue for this document (re-enqueue after a failed run
    // must start clean), then create page-range jobs INSIDE each part. page_start
    // / page_end stay ABSOLUTE (labels, chunk_index, progress); part_first_page
    // lets the worker map them back to a page inside its downloaded part.
    await admin.from("ocr_jobs").delete().eq("document_id", doc.id);

    const jobs: Array<{
      document_id: string;
      user_id: string;
      page_start: number;
      page_end: number;
      storage_path: string;
      part_first_page: number;
    }> = [];
    for (const part of parts) {
      const partLast = part.firstPage + part.pageCount - 1;
      for (let start = part.firstPage; start <= partLast; start += JOB_PAGES) {
        jobs.push({
          document_id: doc.id,
          user_id: user.id,
          page_start: start,
          page_end: Math.min(partLast, start + JOB_PAGES - 1),
          storage_path: part.storagePath,
          part_first_page: part.firstPage,
        });
      }
    }

    for (let i = 0; i < jobs.length; i += 100) {
      const { error: insErr } = await admin.from("ocr_jobs").insert(jobs.slice(i, i + 100));
      if (insErr) {
        console.error("ocr-enqueue job insert error:", insErr);
        return await fail("error", "Could not queue the OCR jobs. Please try again.", 500);
      }
    }

    await admin
      .from("documents")
      .update({
        page_count: pageCount,
        ocr_pages_total: pageCount,
        ocr_pages_done: 0,
        extract_status: "processing",
        extract_error: null,
      })
      .eq("id", doc.id);

    return json({ status: "processing", pageCount, jobs: jobs.length });
  } catch (e) {
    console.error("ocr-enqueue error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
