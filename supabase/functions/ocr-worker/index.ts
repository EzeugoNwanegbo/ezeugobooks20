// G&D - OCR worker: processes exactly ONE ocr_jobs page-range per invocation.
//
// Design (see supabase/migrations/20260706120000_add_ocr_jobs.sql): edge
// functions get ~150 s of wall clock, so OCR-ing a whole scanned book in one
// invocation is impossible. ocr-enqueue splits the book into ~5-page jobs and
// every invocation of this function claims ONE of them via claim_ocr_job
// (FOR UPDATE SKIP LOCKED) - pg_cron ticks and web-client pokes can therefore
// run concurrently without ever double-processing a page.
//
// OCR engine: tesseract-wasm's synchronous OCREngine (no workers, no DOM).
// There is no canvas in Deno to render pages with, so instead we pull the
// scan's embedded page images straight out of pdf.js's operator list
// (paintImageXObject -> page.objs) as raw decoded pixels - scanned PDFs are
// one full-page image per page, which is exactly the case this queue exists
// for. Pages that also carry a real text layer keep it (text + OCR merged),
// so mixed digital/scanned documents work too.
//
// Auth: callers just advance the internal queue and get counts back, so any
// platform-accepted JWT (user session or the anon key, which is what pg_cron
// sends) is fine - all data access below uses the service role and job rows
// carry their own user_id.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getDocumentProxy, getResolvedPDFJS } from "https://esm.sh/unpdf@0.12.1";
import { createOCREngine } from "https://esm.sh/tesseract-wasm@0.10.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Engine bits come off CDNs at boot: the wasm build of tesseract (~2 MB) and
// the "fast" English model (~4 MB - the full-accuracy model is 5x bigger and
// slower; fast is the right trade for study material).
const OCR_WASM_URL = "https://cdn.jsdelivr.net/npm/tesseract-wasm@0.10.0/dist/tesseract-core.wasm";
const OCR_MODEL_URL = "https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0/eng.traineddata";

// Scans come in at their original resolution (often 300 DPI ~ 2550x3300).
// Downscaling the long edge to this bound roughly halves tesseract time with
// no meaningful accuracy loss on printed text.
const MAX_OCR_DIMENSION = 2400;
// Ignore images smaller than this (logos, decorations) - a real scanned page
// is hundreds of thousands of pixels.
const MIN_SCAN_AREA = 100_000;

// Keep chunking identical to extract-pdf (and src/lib/document-chunks.ts).
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 700;
const MAX_ATTEMPTS = 3;

type OcrJob = {
  id: string;
  document_id: string;
  user_id: string;
  page_start: number;
  page_end: number;
  attempts: number;
  // Part-split fields (migration 20260709120000). storage_path is the PART file
  // this job's pages live in; part_first_page is the ABSOLUTE document page that
  // is page 1 of that part. Both are absent/NULL for jobs enqueued before the
  // split, where the whole document is one object (fallbacks handle that).
  storage_path?: string | null;
  part_first_page?: number | null;
};

type RawImage = { data: Uint8ClampedArray | Uint8Array; width: number; height: number };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Ported from extract-pdf/index.ts (which ported it from the web pipeline).
function sanitizeExtractedText(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code === 0) continue;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      out += " ";
      continue;
    }
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += text[i] + text[i + 1];
        i += 1;
      }
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) continue;
    out += text[i];
  }
  return out.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+\n/g, "\n").trim();
}

// --- OCR engine (cached across warm invocations) ----------------------------

// deno-lint-ignore no-explicit-any
let enginePromise: Promise<any> | null = null;

// deno-lint-ignore no-explicit-any
function getEngine(): Promise<any> {
  if (!enginePromise) {
    enginePromise = (async () => {
      const [wasm, model] = await Promise.all([
        fetch(OCR_WASM_URL).then((r) => {
          if (!r.ok) throw new Error(`OCR wasm download failed (HTTP ${r.status}).`);
          return r.arrayBuffer();
        }),
        fetch(OCR_MODEL_URL).then((r) => {
          if (!r.ok) throw new Error(`OCR model download failed (HTTP ${r.status}).`);
          return r.arrayBuffer();
        }),
      ]);
      const engine = await createOCREngine({ wasmBinary: wasm });
      engine.loadModel(new Uint8Array(model));
      return engine;
    })().catch((e) => {
      // Don't cache a failed boot - the next invocation retries from scratch.
      enginePromise = null;
      throw e;
    });
  }
  return enginePromise;
}

// --- Pixel wrangling ---------------------------------------------------------

// pdf.js hands back decoded pixels in whatever layout the PDF stored: RGBA,
// RGB, 8-bit gray, or 1-bit packed black/white (CCITT fax scans - very common
// in scanned textbooks). tesseract-wasm wants RGBA, so normalise here.
function toRgba(img: RawImage): RawImage {
  const { width, height } = img;
  const px = width * height;
  const src = img.data;

  if (src.length === px * 4) {
    return { data: src, width, height };
  }
  const out = new Uint8ClampedArray(px * 4);
  if (src.length === px * 3) {
    for (let i = 0, o = 0; i < src.length; i += 3, o += 4) {
      out[o] = src[i];
      out[o + 1] = src[i + 1];
      out[o + 2] = src[i + 2];
      out[o + 3] = 255;
    }
    return { data: out, width, height };
  }
  if (src.length === px) {
    for (let i = 0, o = 0; i < px; i += 1, o += 4) {
      out[o] = out[o + 1] = out[o + 2] = src[i];
      out[o + 3] = 255;
    }
    return { data: out, width, height };
  }
  const rowBytes = (width + 7) >> 3;
  if (src.length === rowBytes * height) {
    // 1 bit per pixel, rows padded to byte boundaries; set bit = white.
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const bit = (src[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const o = (y * width + x) * 4;
        out[o] = out[o + 1] = out[o + 2] = bit ? 255 : 0;
        out[o + 3] = 255;
      }
    }
    return { data: out, width, height };
  }
  throw new Error(`Unsupported page image layout (${src.length} bytes for ${width}x${height}).`);
}

// Nearest-neighbour downscale - crude but plenty for OCR, and it avoids
// needing any canvas/graphics library in Deno.
function downscale(img: RawImage): RawImage {
  const longEdge = Math.max(img.width, img.height);
  if (longEdge <= MAX_OCR_DIMENSION) return img;
  const scale = MAX_OCR_DIMENSION / longEdge;
  const width = Math.max(1, Math.floor(img.width * scale));
  const height = Math.max(1, Math.floor(img.height * scale));
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const so = (sy * img.width + sx) * 4;
      const o = (y * width + x) * 4;
      out[o] = img.data[so];
      out[o + 1] = img.data[so + 1];
      out[o + 2] = img.data[so + 2];
      out[o + 3] = img.data[so + 3];
    }
  }
  return { data: out, width, height };
}

// --- Page processing ---------------------------------------------------------

// Extracts one page's text: whatever real text layer exists, plus OCR of the
// page's dominant embedded image. Mirrors unpdf's extractImages internals
// (operator-list walk + objs/commonObjs lookup) but keeps width/height, which
// unpdf 0.12 throws away.
async function readPage(
  // deno-lint-ignore no-explicit-any
  pdf: any,
  pageNumber: number,
  // deno-lint-ignore no-explicit-any
  OPS: any,
  // deno-lint-ignore no-explicit-any
  engine: any,
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  try {
    const content = await page.getTextContent();
    // deno-lint-ignore no-explicit-any
    const layerText = (content.items as any[])
      .map((it) => (typeof it?.str === "string" ? it.str : ""))
      .join(" ")
      .trim();

    const opList = await page.getOperatorList();
    let best: RawImage | null = null;
    for (let i = 0; i < opList.fnArray.length; i += 1) {
      if (opList.fnArray[i] !== OPS.paintImageXObject) continue;
      const imageKey = opList.argsArray[i]?.[0];
      if (typeof imageKey !== "string") continue;
      const store = imageKey.startsWith("g_") ? page.commonObjs : page.objs;
      // deno-lint-ignore no-explicit-any
      const image = await new Promise<any>((resolve) => {
        try {
          store.get(imageKey, resolve);
        } catch {
          resolve(null);
        }
      });
      if (!image?.data || !image.width || !image.height) continue;
      if (!best || image.width * image.height > best.width * best.height) {
        best = { data: image.data, width: image.width, height: image.height };
      }
    }

    let ocrText = "";
    if (best && best.width * best.height >= MIN_SCAN_AREA) {
      const rgba = downscale(toRgba(best));
      engine.loadImage({ data: rgba.data, width: rgba.width, height: rgba.height });
      ocrText = (engine.getText() || "").trim();
    }

    return sanitizeExtractedText([layerText, ocrText].filter(Boolean).join("\n"));
  } finally {
    try {
      page.cleanup();
    } catch {
      // ignore cleanup errors
    }
  }
}

// Page-aware chunking, same packing rules as extract-pdf, but jobs only see a
// slice of the book: page labels use ABSOLUTE page numbers, and chunk_index is
// page_start * 100 + i so indexes from different jobs never collide (a 5-page
// job can't produce anywhere near 100 chunks * pages).
type ChunkRow = {
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  page_start: number;
  page_end: number;
  token_estimate: number;
  embedding: string | null;
};

function chunkJobPages(pages: string[], firstPage: number, job: OcrJob): ChunkRow[] {
  const out: { content: string; page_start: number; page_end: number }[] = [];
  let current = "";
  let pageStart: number | null = null;
  let pageEnd: number | null = null;

  const flush = () => {
    const content = current.trim();
    if (content && pageStart !== null && pageEnd !== null) {
      out.push({ content, page_start: pageStart, page_end: pageEnd });
    }
    current = "";
    pageStart = null;
    pageEnd = null;
  };

  pages.forEach((raw, i) => {
    const page = firstPage + i;
    const labelled = `[Page ${page}]\n${raw ?? ""}`;

    if (labelled.length > CHUNK_CHARS) {
      flush();
      let start = 0;
      while (start < labelled.length) {
        const end = Math.min(labelled.length, start + CHUNK_CHARS);
        const slice = labelled.slice(start, end).trim();
        if (slice) out.push({ content: slice, page_start: page, page_end: page });
        if (end >= labelled.length) break;
        start = Math.max(0, end - CHUNK_OVERLAP);
      }
      return;
    }

    if (current && current.length + labelled.length + 2 > CHUNK_CHARS) flush();
    current = current ? `${current}\n\n${labelled}` : labelled;
    pageStart = pageStart ?? page;
    pageEnd = page;
  });

  flush();

  return out.map((c, index) => ({
    document_id: job.document_id,
    user_id: job.user_id,
    chunk_index: job.page_start * 100 + index,
    content: c.content,
    page_start: c.page_start,
    page_end: c.page_end,
    token_estimate: Math.ceil(c.content.length / 4),
    embedding: null,
  }));
}

// --- Finalisation ------------------------------------------------------------

// Once every job is done, assemble extracted_text from the chunks (ordered by
// chunk_index = page order) and mark the document ready. Chat/StudyBody read
// extracted_text + document_chunks, so this is the moment the book becomes
// usable. Assembling from chunks re-includes the small slice overlap of any
// oversized single page - negligible for OCR text and much cheaper than
// re-reading the PDF.
async function finalizeDocument(
  // deno-lint-ignore no-explicit-any
  admin: any,
  documentId: string,
): Promise<"ready" | "error"> {
  const contents: string[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin
      .from("document_chunks")
      .select("content")
      .eq("document_id", documentId)
      .order("chunk_index", { ascending: true })
      .range(from, from + 499);
    if (error) throw error;
    for (const row of data ?? []) contents.push(row.content);
    if (!data || data.length < 500) break;
  }

  const fullText = contents.join("\n\n").trim();
  if (!fullText.replace(/\[Page \d+\]/g, "").trim()) {
    await admin
      .from("documents")
      .update({
        extract_status: "error",
        extract_error:
          "OCR finished but found no readable text in this scan. Try a clearer copy.",
      })
      .eq("id", documentId);
    return "error";
  }

  await admin
    .from("documents")
    .update({ extracted_text: fullText, extract_status: "ready", extract_error: null })
    .eq("id", documentId);
  return "ready";
}

// A worker can be killed between "last job done" and finalisation, leaving a
// fully-OCR'd document stuck at 'processing'. Spare invocations (nothing to
// claim) repair one such document. ocr_pages_total marks docs owned by this
// queue - extract-pdf never sets it.
// deno-lint-ignore no-explicit-any
async function repairStuckDocument(admin: any, documentId?: string): Promise<string | null> {
  let candidates: string[] = [];
  if (documentId) {
    candidates = [documentId];
  } else {
    const { data } = await admin
      .from("documents")
      .select("id")
      .eq("extract_status", "processing")
      .not("ocr_pages_total", "is", null)
      .limit(20);
    candidates = (data ?? []).map((d: { id: string }) => d.id);
  }
  for (const id of candidates) {
    const { data: doc } = await admin
      .from("documents")
      .select("id, extract_status, ocr_pages_total")
      .eq("id", id)
      .single();
    if (!doc || doc.extract_status !== "processing" || doc.ocr_pages_total == null) continue;
    const { data: unfinished } = await admin
      .from("ocr_jobs")
      .select("id")
      .eq("document_id", id)
      .in("status", ["pending", "processing", "error"])
      .limit(1);
    if ((unfinished ?? []).length > 0) continue;
    return await finalizeDocument(admin, id);
  }
  return null;
}

// --- Handler -----------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Body is optional: web pokes send { documentId } to prioritise their own
    // file, pg_cron sends {} to drain whatever is pending.
    let documentId: string | undefined;
    try {
      const body = await req.json();
      if (typeof body?.documentId === "string") documentId = body.documentId;
    } catch {
      // empty body is fine
    }

    const { data: claimedRows, error: claimErr } = await admin.rpc("claim_ocr_job", {
      p_document_id: documentId ?? null,
    });
    if (claimErr) {
      console.error("ocr-worker claim error:", claimErr);
      return json({ error: "Could not claim a job." }, 500);
    }
    const job = (claimedRows as OcrJob[] | null)?.[0];

    if (!job) {
      // Nothing runnable - use the spare invocation to repair any document
      // whose finaliser died, then report status for the poked document.
      const repaired = await repairStuckDocument(admin, documentId);
      return json({ claimed: false, repaired });
    }

    try {
      // 1. Download + open the PART that holds this job's pages. A part is a
      //    <=50 MB slice the web client split off the book, so this download is
      //    small even for a 200 MB textbook. Jobs enqueued before the part split
      //    have no storage_path - fall back to the document's own single object.
      const { data: doc, error: docErr } = await admin
        .from("documents")
        .select("id, user_id, storage_path")
        .eq("id", job.document_id)
        .single();
      if (docErr || !doc) throw new Error("Document row disappeared.");

      const downloadPath = job.storage_path ?? doc.storage_path;
      const { data: file, error: dlErr } = await admin.storage
        .from("documents")
        .download(downloadPath);
      if (dlErr || !file) throw new Error("Could not download the file from storage.");

      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(bytes);
      const { OPS } = await getResolvedPDFJS();
      const engine = await getEngine();

      // 2. OCR this job's ABSOLUTE page range, mapped into the part. Labels and
      //    chunk_index stay absolute (chunkJobPages uses job.page_start below);
      //    only the page we pull from THIS pdf is relative to the part's first
      //    page. Keep the array aligned to the absolute range even if a page is
      //    somehow missing, so page labels never drift.
      const partFirstPage = job.part_first_page ?? 1;
      const pageTexts: string[] = [];
      for (let p = job.page_start; p <= job.page_end; p += 1) {
        const relative = p - partFirstPage + 1;
        if (relative < 1 || relative > pdf.numPages) {
          pageTexts.push("");
          continue;
        }
        pageTexts.push(await readPage(pdf, relative, OPS, engine));
      }

      // 3. Idempotent save: this job owns exactly its page range, so delete +
      //    re-insert only chunks inside it (retries and stale-claim re-runs
      //    can't duplicate or clobber other jobs' chunks).
      const rows = chunkJobPages(pageTexts, job.page_start, job);
      await admin
        .from("document_chunks")
        .delete()
        .eq("document_id", job.document_id)
        .gte("page_start", job.page_start)
        .lte("page_end", job.page_end);

      // Best-effort embeddings, same contract as extract-pdf: forward the
      // caller's token to the embed function. pg_cron pokes carry the anon key
      // (embed will refuse) - that's fine, the web app's background
      // backfillMissingEmbeddings picks up any NULL embeddings later and
      // keyword search works in the meantime.
      try {
        const embedResp = await fetch(`${SUPABASE_URL}/functions/v1/embed`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: req.headers.get("Authorization") ?? "",
          },
          body: JSON.stringify({ texts: rows.map((r) => r.content) }),
        });
        if (embedResp.ok) {
          const body = await embedResp.json();
          const embeddings = Array.isArray(body.embeddings) ? body.embeddings : [];
          rows.forEach((r, i) => {
            r.embedding = embeddings[i] ?? null;
          });
        }
      } catch (e) {
        console.error("ocr-worker embed error:", e);
      }

      for (let i = 0; i < rows.length; i += 50) {
        const { error: insErr } = await admin.from("document_chunks").insert(rows.slice(i, i + 50));
        if (insErr) throw new Error(`Could not save chunks: ${insErr.message}`);
      }

      // 4. Record completion; finalise the document if this was the last job.
      const { data: completed, error: doneErr } = await admin.rpc("complete_ocr_job", {
        p_job_id: job.id,
        p_error: null,
      });
      if (doneErr) throw new Error(`Could not record completion: ${doneErr.message}`);
      const progress = (completed as
        | { doc_id: string; pages_done: number; pages_total: number; remaining: number; failed: number }[]
        | null)?.[0];

      let status = "processing";
      if (progress && progress.remaining === 0 && progress.failed === 0) {
        status = await finalizeDocument(admin, job.document_id);
      }

      return json({
        claimed: true,
        documentId: job.document_id,
        pageStart: job.page_start,
        pageEnd: job.page_end,
        pagesDone: progress?.pages_done ?? null,
        pagesTotal: progress?.pages_total ?? null,
        status,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "OCR failed.";
      console.error(`ocr-worker job ${job.id} (pages ${job.page_start}-${job.page_end}):`, e);
      if (job.attempts >= MAX_ATTEMPTS) {
        // Out of retries: fail the job AND the document (complete_ocr_job
        // propagates the error status).
        await admin.rpc("complete_ocr_job", { p_job_id: job.id, p_error: message });
      } else {
        // Soft failure: hand the job back for another attempt (attempts was
        // already bumped by the claim).
        await admin
          .from("ocr_jobs")
          .update({ status: "pending", error: message, updated_at: new Date().toISOString() })
          .eq("id", job.id);
      }
      return json({ claimed: true, retried: job.attempts < MAX_ATTEMPTS, error: message });
    }
  } catch (e) {
    console.error("ocr-worker error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
