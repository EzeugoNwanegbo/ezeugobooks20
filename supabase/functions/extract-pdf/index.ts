// G&D — server-side PDF extraction for the Links feature.
//
// The web app extracts PDF text with pdf.js in the browser, which cannot run in
// the React Native app. So the native Links flow uploads the PDF to the
// `documents` storage bucket and calls this function with the document id. We:
//   1. download the file with the service role,
//   2. extract text + page count with unpdf (a serverless-friendly pdf.js),
//   3. reject anything over MAX_PAGES (the anti-textbook guard),
//   4. store extracted_text + page_count, then chunk + embed so the chunks feed
//      both Links synthesis and the existing chat / StudyBody hybrid search.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Sanity guard against pathological PDFs. The Library now accepts full textbooks
// (Chat / StudyBody read them via chunked search, and Links only reads ~6k chars
// per doc), so this is a high ceiling rather than the old "focused material" cap.
const MAX_PAGES = 2000;
// Keep chunking identical to the web pipeline (src/lib/document-chunks.ts).
const CHUNK_CHARS = 6000;
const CHUNK_OVERLAP = 700;

type ChunkInput = {
  chunk_index: number;
  content: string;
  page_start: number | null;
  page_end: number | null;
  token_estimate: number;
};

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
    const labelled = `[Page ${page}]\n${(raw ?? "").trim()}`;

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
      .select("id, user_id, file_name, storage_path")
      .eq("id", documentId)
      .eq("user_id", user.id)
      .single();
    if (docErr || !doc) return json({ error: "Document not found." }, 404);

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

      // 3. Anti-textbook guard — reject before doing any AI work.
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
        (t ?? "").toString(),
      );
    } catch (e) {
      const message =
        "Could not read this PDF. If it is a scanned document it has no selectable text — try a text-based PDF.";
      await admin
        .from("documents")
        .update({ extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      console.error("extract-pdf parse error:", e);
      return json({ error: message }, 422);
    }

    const fullText = pageTexts.map((t, i) => `[Page ${i + 1}]\n${t}`).join("\n\n");
    if (!fullText.replace(/\[Page \d+\]/g, "").trim()) {
      const message =
        "This PDF has no selectable text — it looks scanned. Upload a text-based PDF instead.";
      await admin
        .from("documents")
        .update({ page_count: pageCount, extract_status: "error", extract_error: message })
        .eq("id", doc.id);
      return json({ error: message }, 422);
    }

    // 4. Store text, chunk, and (best-effort) embed.
    await admin
      .from("documents")
      .update({
        extracted_text: fullText,
        page_count: pageCount,
        extract_status: "ready",
        extract_error: null,
      })
      .eq("id", doc.id);

    // Replace any prior chunks for this document, then insert fresh ones.
    await admin.from("document_chunks").delete().eq("document_id", doc.id);
    const chunks = chunkPages(pageTexts);

    let embeddings: string[] = [];
    try {
      const embedResp = await fetch(`${SUPABASE_URL}/functions/v1/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ texts: chunks.map((c) => c.content) }),
      });
      if (embedResp.ok) {
        const body = await embedResp.json();
        embeddings = Array.isArray(body.embeddings) ? body.embeddings : [];
      }
    } catch (e) {
      // Embeddings are an optimisation; keyword search still works without them.
      console.error("extract-pdf embed error:", e);
    }

    const rows = chunks.map((c, i) => ({
      document_id: doc.id,
      user_id: user.id,
      chunk_index: c.chunk_index,
      content: c.content,
      page_start: c.page_start,
      page_end: c.page_end,
      token_estimate: c.token_estimate,
      embedding: embeddings[i] ?? null,
    }));

    if (rows.length > 0) {
      // Insert in batches to keep request bodies reasonable.
      for (let i = 0; i < rows.length; i += 50) {
        const { error: insErr } = await admin.from("document_chunks").insert(rows.slice(i, i + 50));
        if (insErr) console.error("extract-pdf chunk insert error:", insErr);
      }
    }

    return json({ status: "ready", pageCount, chunks: rows.length });
  } catch (e) {
    console.error("extract-pdf error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
