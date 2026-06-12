// G&D — Links synthesis ("connect the dots") for the native app.
//
// Given a set of the user's extracted documents (<=10), DeepSeek reads a
// representative excerpt of each and returns the conceptual threads that run
// across them: a core theme, concept nodes, weighted interlinks, theme clusters,
// the single strongest link, the theme's origin, and the one "surprise"
// connection you'd never expect. The result is cached in document_links keyed by
// a hash of the sorted document ids so re-opening the screen is instant.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEEPSEEK_TIMEOUT_MS = 90_000;
// How much of each document we send. ~6k chars x 10 docs keeps us well within
// DeepSeek's context while giving it enough to find real connections.
const EXCERPT_CHARS = 6000;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), ms);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function buildSystemPrompt(): string {
  return `You are G&D's Cross-Document Synthesis engine. The student has uploaded a small set of focused study documents. Your job is to find the genuine conceptual threads that connect them — the "dots" a strong tutor would draw between separate materials.

Rules:
- Use ONLY the supplied excerpts. Never invent facts, documents, or page numbers.
- Connections must be real and specific. If two documents barely relate, say so with a low match score rather than forcing a link.
- "match" is your confidence in the connection, 0.00 to 1.00.
- Reference documents by their exact "Doc N: <name>" label.
- Keep every description tight (one or two sentences), concrete, and useful for revision.

Return ONLY valid JSON (no markdown) with this exact shape:
{
  "coreTheme": "short phrase naming the single biggest shared theme",
  "nodes": [ { "label": "concept (<= 18 chars, may use a newline)", "docs": ["Doc 1: ..."] } ],
  "interlinkCount": <integer estimate of meaningful concept links found>,
  "clusters": [ { "title": "...", "match": 0.0, "description": "what is shared and across which docs", "docs": ["Doc 1: ..."] } ],
  "strongestLink": { "title": "the most strongly shared concept", "description": "where it appears and why it matters" },
  "themeOrigin": { "title": "the concept the theme seems to originate from", "source": "Doc N: <name>" },
  "surprise": { "title": "an unexpected but real connection", "description": "why it is surprising and still valid" }
}

Provide 3-5 nodes and 2-4 clusters. If there is only one document, describe the internal structure of its key ideas instead of cross-document links.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Missing authorization." }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) return json({ error: "DeepSeek API key not configured." }, 500);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ error: "Invalid session." }, 401);

    const body = (await req.json()) as { docIds?: string[]; force?: boolean };
    const docIds = Array.isArray(body.docIds) ? body.docIds.filter(Boolean).slice(0, 10) : [];
    if (docIds.length === 0) return json({ error: "Provide at least one document." }, 400);

    // Load the documents (scoped to the user), keep only successfully extracted.
    const { data: docs, error: docsErr } = await admin
      .from("documents")
      .select("id, file_name, extracted_text, extract_status")
      .eq("user_id", user.id)
      .in("id", docIds);
    if (docsErr) return json({ error: "Could not load documents." }, 500);

    const ready = (docs ?? []).filter(
      (d) => d.extract_status === "ready" && (d.extracted_text ?? "").trim().length > 0,
    );
    if (ready.length === 0) {
      return json({ error: "None of these documents have finished processing yet." }, 409);
    }

    const sortedIds = ready.map((d) => d.id).sort();
    const docSetHash = await sha256Hex(sortedIds.join(","));

    // Return the cached synthesis unless the caller forces a refresh.
    if (!body.force) {
      const { data: cached } = await admin
        .from("document_links")
        .select("result")
        .eq("user_id", user.id)
        .eq("doc_set_hash", docSetHash)
        .maybeSingle();
      if (cached?.result) {
        return json({ cached: true, result: cached.result, documents: nameMap(ready) });
      }
    }

    // Build the excerpt block DeepSeek reasons over.
    const excerpts = ready
      .map((d, i) => {
        const text = (d.extracted_text ?? "").replace(/\[Page \d+\]/g, " ").replace(/\s+/g, " ");
        return `Doc ${i + 1}: ${d.file_name}\n"""${text.slice(0, EXCERPT_CHARS)}"""`;
      })
      .join("\n\n");

    const upstream = await fetchWithTimeout(
      "https://api.deepseek.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-chat",
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: `Here are ${ready.length} document excerpt(s). Find the connections.\n\n${excerpts}`,
            },
          ],
        }),
      },
      DEEPSEEK_TIMEOUT_MS,
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("connect-dots DeepSeek error:", upstream.status, text);
      return json({ error: "Synthesis failed. Please try again." }, 502);
    }

    const completion = await upstream.json();
    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    let result: Record<string, unknown>;
    try {
      result = JSON.parse(raw);
    } catch {
      console.error("connect-dots bad JSON:", raw);
      return json({ error: "Synthesis returned an unreadable result. Try again." }, 502);
    }

    // Cache (upsert) the result for this exact document set.
    await admin.from("document_links").upsert(
      {
        user_id: user.id,
        doc_ids: sortedIds,
        doc_set_hash: docSetHash,
        result,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,doc_set_hash" },
    );

    return json({ cached: false, result, documents: nameMap(ready) });
  } catch (e) {
    console.error("connect-dots error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function nameMap(docs: { id: string; file_name: string }[]): Record<string, string> {
  const map: Record<string, string> = {};
  docs.forEach((d, i) => {
    map[`Doc ${i + 1}`] = d.file_name;
  });
  return map;
}
