// G&D - folder suggestion
// Given a document excerpt + the user's existing folders, suggest a subject.
// Uses DeepSeek for folder classification.
// Returns { folder: string, isNew: boolean }
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Body {
  fileName: string;
  excerpt: string;
  existingFolders: string[];
}

const DEEPSEEK_TIMEOUT_MS = 12_000;

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as Body;
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    if (!DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: "AI not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const excerpt = (body.excerpt || "").slice(0, 6000);
    const existing = (body.existingFolders || []).join(", ") || "(none)";

    const prompt = `You are organising a student's study library.

EXISTING FOLDERS: ${existing}

NEW DOCUMENT FILENAME: ${body.fileName}

DOCUMENT EXCERPT (first ~6000 chars):
"""
${excerpt}
"""

Pick the best subject folder for this document.
- If one of the EXISTING FOLDERS is a clear fit, reuse it exactly.
- Otherwise propose ONE new short subject name (1-3 words, Title Case, e.g. "Mathematics", "Economics", "Biology", "History", "Computer Science").

Respond with ONLY a JSON object: {"folder":"<name>","isNew":<true|false>}
No prose, no markdown.`;

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
          messages: [
            { role: "system", content: "You output strict JSON only. No markdown, no prose." },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
        }),
      },
      DEEPSEEK_TIMEOUT_MS,
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("DeepSeek error:", upstream.status, text);
      return new Response(
        JSON.stringify({ folder: "Uncategorised", isNew: true, fallback: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await upstream.json();
    let raw = json.choices?.[0]?.message?.content ?? "";
    raw = raw
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/```$/, "")
      .trim();
    let parsed: { folder?: string; isNew?: boolean } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Try to extract first {...}
      const m = raw.match(/\{[^}]+\}/);
      if (m) {
        try {
          parsed = JSON.parse(m[0]);
        } catch {
          /* ignore */
        }
      }
    }

    const folder = (parsed.folder || "Uncategorised").toString().slice(0, 50);
    const lower = folder.toLowerCase();
    const isNew =
      parsed.isNew ?? !(body.existingFolders || []).some((f) => f.toLowerCase() === lower);

    return new Response(JSON.stringify({ folder, isNew }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("suggest-folder error:", e);
    return new Response(JSON.stringify({ folder: "Uncategorised", isNew: true, fallback: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
