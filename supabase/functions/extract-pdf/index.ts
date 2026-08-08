// G&D - server-side PDF extraction for the Links feature.
//
// The web app extracts PDF text with pdf.js in the browser, which cannot run in
// the React Native app. So the native Links flow uploads the PDF to the
// `documents` storage bucket and calls this function with the document id. We:
//   1. download the file with the service role,
//   2. extract text + page count with unpdf (a serverless-friendly pdf.js),
//   3. reject anything over MAX_PAGES (the anti-textbook guard),
//   4. store extracted_text + page_count and mark the document 'processing',
//   5. write every chunk in parallel waves, upserting on (document_id,
//      chunk_index) so the document is never emptier than it started,
//   6. drop the tail of any older chunk set, mark 'ready', fingerprint,
//   7. embed in batches with whatever wall clock is left, leaving NULLs behind
//      where it runs out.
// The chunks feed both Links synthesis and the chat / StudyBody hybrid search.
//
// The ordering above is the point, not an accident. This function used to
// (a) delete the document's existing chunks before it had anything to replace
// them with, (b) POST every chunk's text to `embed` in ONE request - ~9 MB for a
// 2,785-page textbook - and (c) insert 50 rows at a time, sequentially, awaiting
// each round trip. The platform killed it mid-loop, and because a kill is not a
// throw, no status was ever written: books were left holding exactly two batches
// of chunks while the app listed them as perfectly normal. Every retry deleted
// that partial result and died in the same place. So now: nothing is deleted
// until its replacement exists, the mandatory work happens before any
// third-party call, and every exit records what actually happened.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sanity guard against pathological PDFs. The Library now accepts full textbooks
// (Chat / StudyBody read them via chunked search, and Links only reads ~6k chars
// per doc), so this is a high ceiling rather than the old "focused material" cap.
//
// Raised 2000 -> 4000 because 2000 was rejecting the single most-uploaded book in
// the corpus: Moore's Clinically Oriented Anatomy is 2,785 pages, and twelve
// students had uploaded it, every one of them refused. Anatomy atlases and
// combined-volume texts routinely clear 2,000 pages, so the old ceiling was
// excluding exactly the material this product exists to read.
const MAX_PAGES = 4000;
// Keep chunking identical to the web pipeline (src/lib/document-chunks.ts).
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 700;

// Batch sizes, both copied from the paths that already do this work at scale
// rather than invented here:
//   EMBED_BATCH  = scripts/ingest-library.mjs's EMBED_BATCH, which is also
//                  exactly the embed function's MAX_INPUTS_PER_REQUEST - so one
//                  batch is one OpenAI call with no hidden fan-out inside embed.
//                  This used to be "the whole book in one body": a 2,785-page
//                  textbook is ~1,500 chunks, ~9 MB of JSON in a single request,
//                  which ate the entire invocation before a row was ever saved.
//   INSERT_BATCH = the web Library's CHUNK_BATCH (src/routes/-app.library-page.tsx).
const EMBED_BATCH = 96;
const INSERT_BATCH = 200;
// The web path fires every insert batch at once and relies on the browser's
// ~6-connections-per-host cap to turn that into waves. Deno has no such cap, so
// the wave size is explicit here; the shape - parallel, not one round trip at a
// time - is the same.
const INSERT_CONCURRENCY = 6;

// Wall clock. The platform kills an edge function at roughly 150 s without
// giving it a chance to write anything, which is how a book could end up half
// chunked and still marked usable. We therefore run against our own deadlines
// and always keep enough time in hand to record the outcome:
//   - the chunk write (the part correctness depends on) must be finished by
//     CHUNK_WRITE_DEADLINE_MS or we stop and mark the document failed;
//   - embeddings are an optimisation, so we stop STARTING batches at
//     EMBED_DEADLINE_MS and leave the rest NULL. Keyword search still works,
//     and the web app's backfillMissingEmbeddings fills them in later.
const CHUNK_WRITE_DEADLINE_MS = 100_000;
const EMBED_DEADLINE_MS = 125_000;
// Stop hammering a broken embed service; the backfill will catch up.
const MAX_EMBED_FAILURES = 2;

type ChunkInput = {
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  token_estimate: number;
};

type ChunkRow = {
  document_id: string;
  user_id: string;
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  token_estimate: number;
  embedding: string | null;
};

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Page-aware chunking, ported from src/lib/document-chunks.ts. unpdf gives us one
// string per page; we label each "[Page N]" then pack pages up to CHUNK_CHARS.
function chunkPages(pages: string[]): ChunkInput[] {
  const out: Omit<ChunkInput, "chunk_index" | "token_estimate">[] = [];
  let current = "";
  let pageStart: number | null = null;
  let pageEnd: number | null = null;

  const flush = () => {
    const content = current.trim();
    if (!content) return;
    out.push({ content, page_start: pageStart, page_end: pageEnd });
    current = "";
    pageStart = null;
    pageEnd = null;
  };

  pages.forEach((raw, i) => {
    const page = i + 1;
    const labelled = `[Page ${page}]\n${sanitizeExtractedText(raw ?? "")}`;

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
    ...c,
    chunk_index: index,
    token_estimate: Math.ceil(c.content.length / 4),
  }));
}

// Writes chunk rows in parallel waves, UPSERTING on (document_id, chunk_index).
//
// Upsert rather than "delete everything, then insert" is the whole safety
// property: this function used to wipe the document's existing chunks before it
// had a single new row to put back, so an invocation that died half way left the
// student with LESS than they started with - and every retry destroyed the
// previous attempt's partial result and then died at the same place. Because the
// extraction is deterministic, upserting index-for-index means a run that is
// killed mid-write has merely replaced the first N chunks with identical ones.
// The document is never emptier than it was, and a retry is pure repair.
//
// Returns as soon as a batch errors or the deadline passes, so the caller still
// has wall clock left to record what happened.
async function writeChunkRows(
  // deno-lint-ignore no-explicit-any
  admin: any,
  rows: ChunkRow[],
  deadlineAt: number,
): Promise<{ written: number; error: string | null; timedOut: boolean }> {
  const starts: number[] = [];
  for (let i = 0; i < rows.length; i += INSERT_BATCH) starts.push(i);

  let cursor = 0;
  let written = 0;
  let error: string | null = null;
  let timedOut = false;

  const worker = async () => {
    // Single-threaded event loop: cursor++ can't interleave with another
    // worker's read-modify-write, so each batch is handed out exactly once.
    while (error === null && !timedOut) {
      if (Date.now() > deadlineAt) {
        timedOut = true;
        return;
      }
      const index = cursor;
      cursor += 1;
      if (index >= starts.length) return;

      const slice = rows.slice(starts[index], starts[index] + INSERT_BATCH);
      const { error: upsertErr } = await admin
        .from("document_chunks")
        .upsert(slice, { onConflict: "document_id,chunk_index" });
      if (upsertErr) {
        error = upsertErr.message ?? "chunk upsert failed";
        return;
      }
      written += slice.length;
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(INSERT_CONCURRENCY, starts.length) }, () => worker()),
  );

  return { written, error, timedOut };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Everything below measures itself against this, not against hope.
  const startedAt = Date.now();

  // Hoisted so the catch-all at the bottom can still record the failure against
  // the right row. An unhandled throw used to leave the document sitting in
  // whatever status it had, with nobody ever told that anything went wrong.
  // deno-lint-ignore no-explicit-any
  let admin: any = null;
  let openDocumentId: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing authorization." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Identify the caller from their JWT, then scope every query to their id.
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Invalid session." }, 401);

    const { documentId } = (await req.json()) as { documentId?: string };
    if (!documentId) return json({ error: "documentId is required." }, 400);

    // DEDUP_SCHEMA_APPLIED - keep in step with src/lib/content-hash.ts.
    // canonical_document_id and content_hash are created by the dedup migration,
    // which is applied by hand. Naming a column PostgREST cannot find fails the
    // WHOLE query, so selecting it before the migration runs turns every upload
    // into "Document not found". Flip this with the migration, not before.
    const DEDUP_SCHEMA_APPLIED = false;

    const { data: doc, error: docErr } = await admin
      .from("documents")
      .select(
        DEDUP_SCHEMA_APPLIED
          ? "id, user_id, file_name, storage_path, canonical_document_id"
          : "id, user_id, file_name, storage_path",
      )
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();
    if (docErr || !doc) return json({ error: "Document not found." }, 404);

    // This document is a link: another documents row already holds the identical
    // extracted text and this one reads through it (documents.canonical_document_id).
    // Re-extracting would burn the work and then write a second copy of chunks
    // that resolution never reads - the exact waste the de-duplication removed.
    if (DEDUP_SCHEMA_APPLIED && (doc as { canonical_document_id?: string | null }).canonical_document_id) {
      await admin
        .from("documents")
        .update({ extract_status: "ready", extract_error: null })
        .eq("id", doc.id);
      return json({ status: "ready", deduplicated: true, chunks: 0 });
    }

    // From here on this document is ours to finish, so any unexpected throw
    // must land on it as an error rather than vanishing into the logs.
    openDocumentId = doc.id;

    // 1. Download the uploaded PDF from private storage.
    const { data: file, error: dlErr } = await admin.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) {
      await admin
        .from("documents")
        .update({ extract_status: "error", extract_error: "Could not read the uploaded file." })
        .eq("id", doc.id);
      return json({ error: "Could not download the file." }, 500);
    }

    // 2. Extract text + page count.
    let pageTexts: string[];
    let pageCount: number;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pdf = await getDocumentProxy(bytes);
      pageCount = pdf.numPages;

      // 3. Anti-textbook guard - reject before doing any AI work.
      if (pageCount > MAX_PAGES) {
        const message = `This PDF has ${pageCount} pages, which is over the ${MAX_PAGES}-page limit. Try splitting it into smaller files.`;
        await admin
          .from("documents")
          .update({ page_count: pageCount, extract_status: "rejected", extract_error: message })
          .eq("id", doc.id);
        return json({ status: "rejected", pageCount, error: message }, 200);
      }

      const result = await extractText(pdf, { mergePages: false });
      pageTexts = (Array.isArray(result.text) ? result.text : [result.text]).map((t) =>
        sanitizeExtractedText((t ?? "").toString()),
      );
    } catch (e) {
      const message =
        "Could not read this PDF. If it is a scanned document it has no selectable text - try a text-based PDF.";
      await admin
        .from("documents")
        .update({ extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      console.error("extract-pdf parse error:", e);
      return json({ error: message }, 422);
    }

    const fullText = sanitizeExtractedText(
      pageTexts.map((t, i) => `[Page ${i + 1}]\n${t}`).join("\n\n"),
    );
    if (!fullText.replace(/\[Page \d+\]/g, "").trim()) {
      const message =
        "This PDF has no selectable text - it looks scanned. Upload a text-based PDF instead.";
      await admin
        .from("documents")
        .update({ page_count: pageCount, extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      return json({ error: message }, 422);
    }

    // 4. Store the text and say plainly that the document is NOT usable yet.
    //
    // This update used to write extract_status 'ready' here, before a single
    // chunk existed. Anything that killed the invocation during chunking then
    // left a book the app happily listed and searched, holding a fraction of its
    // content - the student asked a question and simply got nothing back, with
    // no hint that the file was broken. 'processing' is the same value the OCR
    // queue writes while it is mid-book (ocr-enqueue), so every reader already
    // treats it as "listed, not groundable": connect-dots and last-minute skip
    // anything that isn't 'ready', the mobile Library tags it PROCESSING, and
    // the dedup views hold it out of merges. ocr-worker's stuck-document repair
    // only touches rows with ocr_pages_total set, which this path never sets, so
    // it will not adopt our documents either.
    const chunks = chunkPages(pageTexts);

    const { error: textErr } = await admin
      .from("documents")
      .update({
        extracted_text: fullText,
        page_count: pageCount,
        extract_status: "processing",
        extract_error: null,
      })
      .eq("id", doc.id);
    // Links synthesis reads extracted_text, so there is no point chunking if
    // this did not land. Let the catch-all record it against the document.
    if (textErr) throw new Error(`Could not save the extracted text: ${textErr.message}`);

    const rows: ChunkRow[] = chunks.map((c) => ({
      document_id: doc.id,
      user_id: user.id,
      chunk_index: c.chunk_index,
      content: c.content,
      page_start: c.page_start,
      page_end: c.page_end,
      token_estimate: c.token_estimate,
      // Written NULL first, on purpose: see the embedding pass below.
      embedding: null,
    }));

    if (rows.length === 0) {
      const message =
        "This PDF has no readable text once it was split up. Try a text-based PDF instead.";
      await admin
        .from("documents")
        .update({ page_count: pageCount, extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      return json({ status: "error", error: message }, 422);
    }

    // 5. Write every chunk, with no embeddings, in parallel waves.
    //
    // This is the only part the document's usefulness depends on, so it happens
    // first and on its own: pure database work, no third-party call in the way.
    // Embeddings come afterwards as a best-effort pass, which means a slow or
    // dead OpenAI can no longer stop a book from being searchable at all.
    const write = await writeChunkRows(admin, rows, startedAt + CHUNK_WRITE_DEADLINE_MS);

    if (write.error || write.timedOut) {
      // Fail loudly and say something the student can act on. Note what we do
      // NOT do here: prune, or mark ready. The chunks written so far are valid
      // and stay put, so this document is never worse off than before the run,
      // and a retry overwrites them index-for-index.
      const message = write.error
        ? `Could not save this document's searchable text (${write.error}). Try uploading it again.`
        : `This PDF (${pageCount} pages) is too big to finish processing in one go - ${write.written} of ${rows.length} sections were saved before time ran out. Split it into two or three smaller PDFs and upload those instead.`;
      await admin
        .from("documents")
        .update({ page_count: pageCount, extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      console.error("extract-pdf chunk write failed:", {
        documentId: doc.id,
        written: write.written,
        total: rows.length,
        error: write.error,
        timedOut: write.timedOut,
        elapsedMs: Date.now() - startedAt,
      });
      return json({ status: "error", chunks: write.written, pageCount, error: message }, 200);
    }

    // 6. Every new chunk is in. Only now is it safe to drop the tail of any
    // older, longer chunk set (a previous extraction, or an OCR run whose
    // indexes are sparse) - the replacement already exists. Best-effort: stale
    // trailing chunks are duplicated context, not lost content.
    const { error: pruneErr } = await admin
      .from("document_chunks")
      .delete()
      .eq("document_id", doc.id)
      .gte("chunk_index", rows.length);
    if (pruneErr) console.error("extract-pdf stale chunk prune error:", pruneErr);

    // 7. The book is complete and searchable: say so. If even this fails the
    // document stays 'processing' - still honest, still retryable, and the
    // re-run's upserts are idempotent - so report that rather than success.
    const { error: readyErr } = await admin
      .from("documents")
      .update({ extract_status: "ready", extract_error: null })
      .eq("id", doc.id);
    if (readyErr) {
      console.error("extract-pdf ready status write failed:", readyErr);
      return json(
        {
          status: "processing",
          pageCount,
          chunks: rows.length,
          error:
            "Saved this document's text, but could not finish marking it ready. Try opening it again in a moment.",
        },
        200,
      );
    }

    // Fingerprint what we just wrote so the NEXT student to upload this book
    // links to it instead of storing a second copy. The browser upload path
    // hashes before it writes; here the text only exists after the work, so
    // the hash is stamped afterwards. Best-effort: a missing hash costs
    // storage on a future upload, nothing else.
    const { error: hashErr } = await admin.rpc("refresh_document_content_hash", {
      p_document_id: doc.id,
    });
    if (hashErr) console.error("extract-pdf content hash error:", hashErr);

    // 8. Embeddings, batched and on whatever wall clock is left.
    //
    // Deliberately after the document is marked ready: everything from here on
    // is an optimisation, so being killed mid-pass costs semantic ranking on
    // some chunks and nothing else. Failed or skipped batches simply leave
    // `embedding` NULL - hybrid search falls back to keywords, and the web
    // app's backfillMissingEmbeddings (src/lib/embeddings.ts) sweeps up any
    // NULLs for this user the next time they open the Library.
    let embedded = 0;
    let embedFailures = 0;
    let embedTruncated = false;

    for (let i = 0; i < rows.length; i += EMBED_BATCH) {
      if (Date.now() - startedAt > EMBED_DEADLINE_MS) {
        embedTruncated = true;
        break;
      }
      if (embedFailures >= MAX_EMBED_FAILURES) {
        embedTruncated = true;
        break;
      }

      const slice = rows.slice(i, i + EMBED_BATCH);
      let vectors: string[] = [];
      try {
        const embedResp = await fetch(`${SUPABASE_URL}/functions/v1/embed`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ texts: slice.map((r) => r.content) }),
        });
        if (embedResp.ok) {
          const body = await embedResp.json();
          vectors = Array.isArray(body.embeddings) ? body.embeddings : [];
        } else {
          embedFailures += 1;
          console.error("extract-pdf embed batch HTTP", embedResp.status, await embedResp.text());
        }
      } catch (e) {
        embedFailures += 1;
        console.error("extract-pdf embed error:", e);
      }

      const withVectors = slice
        .map((r, j) => ({ ...r, embedding: vectors[j] ?? null }))
        .filter((r) => r.embedding !== null);
      if (withVectors.length === 0) continue;

      // Same upsert key as the write above, so this only fills in `embedding`
      // on rows that are already there.
      const { error: embedUpsertErr } = await admin
        .from("document_chunks")
        .upsert(withVectors, { onConflict: "document_id,chunk_index" });
      if (embedUpsertErr) {
        embedFailures += 1;
        console.error("extract-pdf embedding upsert error:", embedUpsertErr);
        continue;
      }
      embedded += withVectors.length;
    }

    return json({
      status: "ready",
      pageCount,
      chunks: rows.length,
      embedded,
      // True means "searchable now, semantic ranking catches up later".
      embeddingsPending: embedTruncated || embedded < rows.length,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("extract-pdf error:", e);
    const message = e instanceof Error ? e.message : "Unknown error";

    // Never leave a half-processed document looking fine. The worst case that
    // remains is the platform killing the isolate outright, and even then the
    // document is still 'processing' (or 'pending', as the uploader set it) -
    // never 'ready' - so nothing downstream will treat it as complete.
    if (admin && openDocumentId) {
      try {
        await admin
          .from("documents")
          .update({
            extract_status: "error",
            extract_error: `Processing this PDF failed (${message}). Try uploading it again, or split it into smaller files.`,
          })
          .eq("id", openDocumentId);
      } catch (statusErr) {
        console.error("extract-pdf could not record the failure:", statusErr);
      }
    }

    return json({ error: message }, 500);
  }
});
