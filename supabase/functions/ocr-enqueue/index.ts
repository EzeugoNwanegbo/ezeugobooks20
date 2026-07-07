// G&D - OCR dispatcher for large scanned PDFs (web Library, > 50 pages).
//
// The web app OCRs small scans in the browser (src/lib/pdf.ts); big ones come
// here. This function does NO OCR itself - edge functions get ~150 s of wall
// clock, so a whole book can never finish in one invocation. Instead we:
//   1. download the uploaded PDF and read its page count with unpdf,
//   2. guard against files too big/long to ever finish,
//   3. split the document into small page-range jobs (ocr_jobs table) that
//      each fit comfortably inside one ocr-worker invocation,
//   4. mark the document 'processing' with ocr_pages_total for the progress
//      bar, and return immediately.
// The queue then drains via pg_cron and/or the web client poking ocr-worker
// (see supabase/migrations/20260706120000_add_ocr_jobs.sql for the design).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pages per job. Each ocr-worker invocation re-downloads + re-parses the PDF
// and OCRs this many pages (~2-8 s of wasm OCR per page), so the batch must
// stay well inside the worker's wall-clock budget. Overridable per-project
// without a redeploy via the OCR_JOB_PAGES function secret.
const JOB_PAGES = Math.max(1, Number(Deno.env.get("OCR_JOB_PAGES") ?? "5") || 5);

// The whole file must fit in the isolate's memory (256 MB) in BOTH this
// function and every worker invocation, alongside pdf.js structures and the
// OCR engine. 50 MB also matches the storage bucket's default object limit,
// so anything bigger has already failed at upload.
const MAX_OCR_BYTES = 50 * 1024 * 1024;

// OCR takes seconds per page even on the server; past this the queue would
// take hours and the user is better served splitting the file.
const MAX_OCR_PAGES = 800;

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

    const { documentId } = (await req.json()) as { documentId?: string };
    if (!documentId) return json({ error: "documentId is required." }, 400);

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
        )} MB server OCR limit. Split it into smaller parts and upload those instead.`,
        200,
      );
    }

    // Download once, purely to count pages - the workers re-download for their
    // own ranges. (No text extraction here: the web client only routes files
    // to this queue after pdf.js found ZERO text layer, and unpdf is the same
    // engine, so re-checking would just burn the wall clock.)
    const { data: file, error: dlErr } = await admin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) {
      return await fail("error", "Could not read the uploaded file.", 500);
    }

    let pageCount: number;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(bytes);
      pageCount = pdf.numPages;
    } catch (e) {
      console.error("ocr-enqueue parse error:", e);
      return await fail(
        "error",
        "Could not open this PDF on the server. It may be damaged or password-protected.",
        422,
      );
    }

    if (pageCount > MAX_OCR_PAGES) {
      return await fail(
        "rejected",
        `This PDF has ${pageCount} pages - over the ${MAX_OCR_PAGES}-page OCR limit. Split it into smaller files.`,
        200,
      );
    }

    // Reset any previous queue for this document (re-enqueue after a failed
    // run must start clean), then create the page-range jobs.
    await admin.from("ocr_jobs").delete().eq("document_id", doc.id);

    const jobs: { document_id: string; user_id: string; page_start: number; page_end: number }[] =
      [];
    for (let start = 1; start <= pageCount; start += JOB_PAGES) {
      jobs.push({
        document_id: doc.id,
        user_id: user.id,
        page_start: start,
        page_end: Math.min(pageCount, start + JOB_PAGES - 1),
      });
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
