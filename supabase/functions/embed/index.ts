// G&D - embedding edge function
//
// Turns text into OpenAI text-embedding-3-small vectors (1536-dim). Used for two
// things, both client-driven:
//   1. Indexing: the library page embeds each document chunk on upload (and
//      backfills chunks that are missing a vector).
//   2. Retrieval: chat + StudyBody embed the live question so the hybrid search
//      RPC can rank by meaning, not just shared keywords.
//
// Returns embeddings as pgvector literal strings ("[0.1,0.2,...]") so callers can
// hand them straight to Postgres without any client-side serialisation quirks.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const EMBED_TIMEOUT_MS = 60_000;
// OpenAI accepts large batches, but keep request bodies sane and avoid timeouts.
const MAX_INPUTS_PER_REQUEST = 96;
// Stay well under the 8191-token model limit; chunks are ~1500 tokens but
// callers may send arbitrary text.
const MAX_CHARS_PER_INPUT = 24_000;

interface EmbedBody {
  texts?: string[];
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function toVectorLiteral(values: number[]): string {
  return `[${values.join(",")}]`;
}

async function embedBatch(apiKey: string, inputs: string[]): Promise<number[][]> {
  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/embeddings",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        input: inputs,
      }),
    },
    EMBED_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI embeddings error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const data = (json.data ?? []) as { embedding: number[]; index: number }[];
  // The API preserves input order, but sort by index to be safe.
  return data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as EmbedBody;
    const rawTexts = Array.isArray(body.texts) ? body.texts : [];
    const texts = rawTexts.map((text) => (text ?? "").toString().slice(0, MAX_CHARS_PER_INPUT));

    if (texts.length === 0) {
      return new Response(JSON.stringify({ error: "Provide a non-empty 'texts' array." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // OpenAI rejects empty strings; substitute a single space so indexes line up
    // with the caller's input array.
    const safeTexts = texts.map((text) => (text.trim().length === 0 ? " " : text));

    const vectors: number[][] = [];
    for (let i = 0; i < safeTexts.length; i += MAX_INPUTS_PER_REQUEST) {
      const batch = safeTexts.slice(i, i + MAX_INPUTS_PER_REQUEST);
      vectors.push(...(await embedBatch(OPENAI_API_KEY, batch)));
    }

    return new Response(
      JSON.stringify({
        model: EMBEDDING_MODEL,
        dimensions: EMBEDDING_DIMENSIONS,
        embeddings: vectors.map(toVectorLiteral),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("embed error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
