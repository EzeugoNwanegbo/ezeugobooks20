// G&D - Last Minute study synthesis.
//
// Turns up to 10 of the user's ready study files into one topic-organized master note.
// The output is deliberately clean Markdown without asterisk styling so the app
// can render readable notes across chat, downloads, and My Coach handoff.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_DOCS = 10;
const MAX_PAGES = 100;
const DEEPSEEK_TIMEOUT_MS = 120_000;
const TOTAL_EXCERPT_CHARS = 100_000;
type FileKind = "pdf" | "pptx" | "docx" | "text" | "image";

type DocumentRow = {
  id: string;
  file_name: string;
  file_type: string | null;
  extracted_text: string | null;
  extract_status: string | null;
  page_count: number | null;
  user_id: string;
};

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

function fileKind(doc: DocumentRow): FileKind | null {
  const type = (doc.file_type ?? "").toLowerCase();
  const name = doc.file_name.toLowerCase();
  if (type === "pdf" || type.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (type === "pptx" || type.includes("presentation") || name.endsWith(".pptx")) return "pptx";
  if (type === "docx" || type.includes("wordprocessing") || name.endsWith(".docx")) return "docx";
  if (type === "text" || type.startsWith("text/") || name.endsWith(".txt")) return "text";
  if (type === "image" || type.startsWith("image/") || /\.(png|jpe?g|webp)$/i.test(name)) {
    return "image";
  }
  return null;
}

function kindLabel(kind: FileKind | null): string {
  if (kind === "pdf") return "PDF";
  if (kind === "pptx") return "PowerPoint";
  if (kind === "docx") return "Word";
  if (kind === "text") return "Text";
  if (kind === "image") return "Image";
  return "Unsupported";
}

function cleanText(text: string): string {
  return text
    .replace(/\[Page\s+\d+\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanAiText(text: string): string {
  return text
    .replace(/^\s*\*\s+/gm, "- ")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(\d)\s*\*\s*(\d)/g, "$1 x $2")
    .replace(/([A-Za-z])\s*\*\s*([A-Za-z])/g, "$1 x $2")
    .replace(/\*/g, "");
}

function sampleText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const part = Math.floor(maxChars / 3);
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(part / 2));
  return [
    text.slice(0, part),
    "[middle excerpt]",
    text.slice(middleStart, middleStart + part),
    "[ending excerpt]",
    text.slice(Math.max(0, text.length - part)),
  ].join("\n\n");
}

function buildSystemPrompt(): string {
  return `You are G&D Last Minute, an AI study synthesis engine for students preparing close to an exam.

Your task:
- Combine the supplied study files into one unified study guide.
- Organize by topic and concept, not by document.
- Remove duplicate explanations and merge overlapping information.
- Connect related concepts across documents clearly.
- Preserve useful differences between documents when they matter.
- Do not invent facts, page numbers, sources, references, or clinical details.

Output rules:
- Return ONLY valid JSON with this shape: {"title":"...","note":"..."}.
- The note must be clean Markdown using headings, short paragraphs, numbered steps, hyphen bullets, and tables when helpful.
- Never output asterisk characters. Do not use asterisks for emphasis, bullets, multiplication, footnotes, or decoration.
- Use plain labels instead of bold syntax.
- Use x for multiplication.
- For maths or equations, define every variable and show the solution steps in order.
- Every major section must include Confidence: High, Medium, or Low.
- Every major section must include Supported by: Doc labels that actually support it.
- If the documents disagree or are incomplete, say that clearly under the affected topic.

Suggested note structure:
# Last Minute Master Note
## How to use this guide
## High-yield overview
## Topic 1
Confidence: High
Supported by: Doc 1, Doc 3
Content...
## Topic 2
...
## Cross-document connections
## Repeated ideas removed
## Final revision checklist`;
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

    const body = (await req.json()) as { docIds?: string[] };
    const docIds = Array.isArray(body.docIds)
      ? [...new Set(body.docIds.filter(Boolean))].slice(0, MAX_DOCS)
      : [];
    if (docIds.length === 0) return json({ error: "Choose at least one study file." }, 400);

    const { data: docs, error: docsErr } = await admin
      .from("documents")
      .select("id, user_id, file_name, file_type, extracted_text, extract_status, page_count")
      .eq("user_id", user.id)
      .in("id", docIds);
    if (docsErr) return json({ error: "Could not load selected documents." }, 500);

    const rows = ((docs ?? []) as DocumentRow[]).filter((doc) => doc.user_id === user.id);
    if (rows.length !== docIds.length) {
      return json({ error: "Some selected documents could not be found." }, 404);
    }

    const invalid = rows.find((doc) => {
      const kind = fileKind(doc);
      const pageCount = doc.page_count ?? 0;
      const hasText = Boolean((doc.extracted_text ?? "").trim());
      const ready = doc.extract_status === "ready" || (!doc.extract_status && hasText);
      return (
        !kind ||
        ((kind === "pdf" || kind === "pptx") && pageCount > MAX_PAGES) ||
        !ready ||
        !hasText
      );
    });
    if (invalid) {
      const kind = fileKind(invalid);
      if (!kind) {
        return json({
          error: `${invalid.file_name} is not a supported Last Minute file. Use PDF, PowerPoint, Word, text, or image notes.`,
        }, 400);
      }
      if ((kind === "pdf" || kind === "pptx") && (invalid.page_count ?? 0) > MAX_PAGES) {
        return json({
          error: `${invalid.file_name} is over ${MAX_PAGES} ${kind === "pptx" ? "slides" : "pages"}.`,
        }, 400);
      }
      if (invalid.extract_status && invalid.extract_status !== "ready") {
        return json({ error: `${invalid.file_name} is still processing.` }, 409);
      }
      return json({ error: `${invalid.file_name} has no extracted text yet.` }, 409);
    }

    const perDocBudget = Math.max(5000, Math.floor(TOTAL_EXCERPT_CHARS / rows.length));
    const excerpts = rows
      .map((doc, index) => {
        const label = `Doc ${index + 1}: ${doc.file_name}`;
        const kind = fileKind(doc);
        const pages = doc.page_count
          ? `${kind === "pptx" ? "Slides" : "Pages"}: ${doc.page_count}`
          : "Length: unknown";
        const text = sampleText(cleanText(doc.extracted_text ?? ""), perDocBudget);
        return `${label}\nType: ${kindLabel(kind)}\n${pages}\n"""${text}"""`;
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
          temperature: 0.25,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: buildSystemPrompt() },
            {
              role: "user",
              content: `Create one topic-organized Last Minute Master Note from these ${rows.length} study file excerpts.\n\n${excerpts}`,
            },
          ],
        }),
      },
      DEEPSEEK_TIMEOUT_MS,
    );

    if (!upstream.ok) {
      const text = await upstream.text();
      console.error("last-minute DeepSeek error:", upstream.status, text);
      return json({ error: "Last Minute synthesis failed. Please try again." }, 502);
    }

    const completion = await upstream.json();
    const raw = completion.choices?.[0]?.message?.content ?? "{}";
    let result: { title?: unknown; note?: unknown };
    try {
      result = JSON.parse(raw);
    } catch {
      console.error("last-minute bad JSON:", raw);
      return json({ error: "Last Minute returned an unreadable result. Try again." }, 502);
    }

    const title =
      typeof result.title === "string" && result.title.trim()
        ? cleanAiText(result.title.trim())
        : "Last Minute Master Note";
    const note = cleanAiText(typeof result.note === "string" ? result.note : "");
    if (!note.trim()) return json({ error: "Last Minute returned an empty note. Try again." }, 502);

    return json({
      title,
      note,
      documents: rows.map((doc) => ({
        id: doc.id,
        file_name: doc.file_name,
        file_type: doc.file_type,
        page_count: doc.page_count,
      })),
    });
  } catch (e) {
    console.error("last-minute error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
