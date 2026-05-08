// G&D — chat edge function
//
// FAST DOCUMENT PIPELINE:
//   GPT streams directly from selected/smart library excerpts first so the
//   client gets tokens quickly. DeepSeek is only used as a fallback when GPT is
//   rate-limited.
//
// PLAIN CHAT (no documents):
//   GPT-4o-mini handles general study questions directly (no DeepSeek needed).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-Medai-Model, X-Medai-Source, X-Medai-Fallback",
};

interface Profile {
  name?: string;
  university?: string;
  year?: string;
  exam_format?: string;
  curriculum?: string | null;
  preferred_mode?: string;
  weak_areas?: string[];
  recent_topics?: string[];
}

interface DocumentCtx {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
}

interface WebSource {
  title: string;
  url: string;
}

type Mode = "Simplified" | "Detailed" | "Storytelling";
type DocumentMode = "none" | "smart" | "selected";
type RouteDecision = "direct" | "library" | "web_search" | "web_curriculum";

interface ChatBody {
  messages: { role: "user" | "assistant"; content: string }[];
  profile: Profile;
  mode: Mode;
  documents?: DocumentCtx[];
  documentMode?: DocumentMode;
  forceWebSearch?: boolean;
  interlink?: boolean;
}

// Keep the research prompt focused so the first streamed token arrives quickly.
const MAX_DOC_CHARS_TOTAL = 120_000;
const DEEPSEEK_MAX_TOKENS = 2400;
const DEEPSEEK_TIMEOUT_MS = 18_000;
const GPT_STREAM_START_TIMEOUT_MS = 18_000;
const ROUTER_TIMEOUT_MS = 5_000;
const WEB_CURRICULUM_TIMEOUT_MS = 10_000;
const LENGTH_LIMIT_NOTE =
  '\n\n**Note:** The AI hit its response length limit before finishing. Ask "continue" and it can pick up from here.';

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

function curriculumText(p: Profile): string {
  return (p.curriculum || "").trim();
}

function withLengthLimitNote(text: string, finishReason?: string | null): string {
  return finishReason === "length" ? `${text}${LENGTH_LIMIT_NOTE}` : text;
}

function isWebCurriculumPreference(value: string): boolean {
  return (
    /\b(no|dont|don't|do not)\b.{0,40}\b(curriculum|syllabus)\b/i.test(value) ||
    /\bweb\b.{0,30}\b(curriculum|syllabus)\b/i.test(value) ||
    /\b(curriculum|syllabus)\b.{0,30}\b(web|fallback|unknown|not sure)\b/i.test(value) ||
    /\b(i|we)\s+(dont|don't|do not)\s+have\s+(one|it)\b/i.test(value)
  );
}

function uniqueSources(sources: WebSource[]): WebSource[] {
  const seen = new Set<string>();
  return sources
    .filter((source) => source.url)
    .filter((source) => {
      const key = source.url.trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function explicitCurriculum(p: Profile): string {
  const value = curriculumText(p);
  if (!value || isWebCurriculumPreference(value)) return "";
  return value;
}

function messageRequestsWebCurriculum(messages: ChatBody["messages"]): boolean {
  return messages
    .slice(-6)
    .some((message) => message.role === "user" && isWebCurriculumPreference(message.content));
}

function shouldUseWebCurriculumFallback(p: Profile, messages: ChatBody["messages"]): boolean {
  if (explicitCurriculum(p)) return false;
  return isWebCurriculumPreference(curriculumText(p)) || messageRequestsWebCurriculum(messages);
}

function curriculumRule(p: Profile, usingWebCurriculum: boolean): string {
  const curriculum = explicitCurriculum(p);

  if (curriculum) {
    return `Curriculum/syllabus: ${curriculum}
- Use this curriculum as the main structure for learning priorities and exam emphasis.`;
  }

  if (usingWebCurriculum) {
    return `Curriculum/syllabus: not provided; the student does not have one.
- Use the WEB CURRICULUM GUIDANCE supplied in the user message to structure the lesson.
- Clearly say this is a web-guided outline, not the student's official school syllabus.
- Do not list website URLs in the answer body; the app will show clickable source icons separately.`;
  }

  if (isWebCurriculumPreference(curriculumText(p))) {
    return `Curriculum/syllabus: the student said they do not have one.
- Use broad course-level learning priorities and exam-relevant structure.
- Do not repeat the curriculum question unless the student asks for school-specific planning.`;
  }

  return `Curriculum/syllabus: not provided yet.
- Start by briefly asking which curriculum or syllabus the student is using.
- Tell them that if they do not have one, they can say "I don't have one" and G&D will use web curriculum guidance.
- Still answer the immediate question, but mark curriculum-specific priorities as provisional.`;
}

function questionNeedsWebCurriculumGuidance(
  messages: ChatBody["messages"],
  hasDocs: boolean,
): boolean {
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const content = lastUserMessage?.content ?? "";

  if (
    /\b(curriculum|syllabus|study\s*plan|study\s*schedule|learning\s*objectives?|course\s*outline|exam\s*blueprint|key\s*topics?|high\s*yield|what\s+should\s+i\s+study|where\s+should\s+i\s+start)\b/i.test(
      content,
    )
  ) {
    return true;
  }

  return !hasDocs && content.trim().split(/\s+/).length <= 6;
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

function modeInstruction(mode: Mode, examFormat: string): string {
  if (mode === "Storytelling") {
    return `Present the answer as a SHORT STORY.
- Use a relatable narrative, classroom moment, real-world scenario, or step-by-step journey through the idea.
- Weave the subject matter naturally into the story so facts stick in memory.
- 3–5 short paragraphs. End with "**The takeaway:**" (2 lines max).
- Then on a new line: "**Study tip:**" - one sentence directly relevant to ${examFormat} assessment.`;
  }
  if (mode === "Detailed") {
    return `Present the answer in DETAILED mode.
- Cover the core idea, reasoning, examples, exceptions, and exam points.
- Use short tables or bullet lists where they help clarity.
- End with "**Study tip:**" - one sentence directly relevant to ${examFormat} assessment.`;
  }
  // Simplified (default)
  return `Present the answer in SIMPLIFIED mode.
- Use plain English and one real-world analogy to make the concept click.
- Maximum 3 short paragraphs — no jargon without explanation.
- End with "**Study tip:**" - one sentence directly relevant to ${examFormat} assessment.`;
}

/** System prompt for DeepSeek — pure fact extraction, no style. */
function buildDeepSeekSystemPrompt(
  p: Profile,
  docs: DocumentCtx[],
  interlink: boolean,
  usingWebCurriculum: boolean,
): string {
  const perDoc = Math.max(2000, Math.floor(MAX_DOC_CHARS_TOTAL / docs.length));
  const docList = docs
    .map((d) => `- ${d.file_name}${d.folder ? ` (folder: ${d.folder})` : ""}`)
    .join("\n");
  const docContent = docs
    .map(
      (d) =>
        `=== DOCUMENT: ${d.file_name}${d.folder ? ` | folder: ${d.folder}` : ""} (id:${d.id}) ===\n${d.excerpt.slice(0, perDoc)}`,
    )
    .join("\n\n");

  const interlinkBlock = interlink
    ? `
INTERLINK TASK:
The student wants connections drawn ACROSS subjects/folders.
- Pull relevant facts from MULTIPLE documents/folders.
- For each connection, note which document/folder it comes from.
- List all cross-subject links clearly so the next stage can highlight them.`
    : "";

  return `You are a precise study research assistant. Your only job is to extract and organise the raw facts that answer the student's question.

STUDENT CONTEXT:
- Level: ${p.year || "Unknown"} at ${p.university || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, usingWebCurriculum)}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none"}

AVAILABLE DOCUMENTS:
${docList}

DOCUMENT CONTENT:
${docContent}
${interlinkBlock}

YOUR TASK:
1. Find every piece of information in the documents relevant to the student's question.
2. If relevant info is NOT in the documents, clearly label it "[General knowledge]".
3. Note the document name (and page if shown as "[Page N]") next to each fact.
4. Output a structured, factual summary — bullet points and short paragraphs are fine.
5. DO NOT apply any teaching style. DO NOT simplify or storytell. Just give the raw, accurate facts.
6. If you are uncertain about anything, say so explicitly.`;
}

/** System prompt for GPT — style rewriter, human touch. */
function buildDeepSeekDraftSystemPrompt(p: Profile, usingWebCurriculum: boolean): string {
  return `You are a precise study research assistant. Prepare the accurate first draft that answers the student's question.

STUDENT CONTEXT:
- Level: ${p.year || "Unknown"} at ${p.university || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, usingWebCurriculum)}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none"}

YOUR TASK:
1. Answer with accurate facts and clear reasoning.
2. Include exam-relevant points where useful.
3. If unsure, say what needs verification.
4. Do not apply a teaching style yet. Keep it factual so the next stage can rewrite it.`;
}

function buildGPTRewriterSystemPrompt(
  p: Profile,
  mode: Mode,
  interlink: boolean,
  usingWebCurriculum: boolean,
): string {
  const interlinkBlock = interlink
    ? `
INTERLINK STYLE:
- Explicitly highlight how concepts from different subjects connect.
- Use a subheading per subject/folder, then a final "**Connections found:**" bullet list
  naming every source document used.`
    : "";

  return `You are G&D, a warm and brilliant study tutor who genuinely cares about students.

You will receive a structured factual summary prepared by a research assistant who just read the student's uploaded notes.
Your job is to transform that raw summary into a response the student will actually enjoy reading and remember.

STUDENT PROFILE:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, usingWebCurriculum)}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(p.recent_topics || []).slice(0, 8).join(", ") || "none yet"}

STYLE INSTRUCTIONS:
${modeInstruction(mode, p.exam_format || "MCQ")}
${interlinkBlock}

RULES:
- Preserve every fact from the research summary — do not drop or invent information.
- Keep source references (document names / page numbers) where they appear in the summary.
- If the summary says "[General knowledge]", keep that label so the student knows.
- Write as if you are talking directly to ${p.name || "the student"} — warm, clear, encouraging.
- Use markdown: bold key terms, short paragraphs, bullet lists where helpful.
- If the research summary says it is uncertain about something, reflect that uncertainty honestly.`;
}

function buildGPTDocumentSystemPrompt(
  p: Profile,
  mode: Mode,
  interlink: boolean,
  usingWebCurriculum: boolean,
): string {
  const interlinkBlock = interlink
    ? `
INTERLINK STYLE:
- Explicitly highlight how concepts from different subjects connect.
- Use a subheading per subject/folder, then a final "**Connections found:**" bullet list
  naming every source document used.`
    : "";

  return `You are G&D, a warm and brilliant study tutor who answers from the student's uploaded document excerpts.

STUDENT PROFILE:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, usingWebCurriculum)}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(p.recent_topics || []).slice(0, 8).join(", ") || "none yet"}

STYLE INSTRUCTIONS:
${modeInstruction(mode, p.exam_format || "MCQ")}
${interlinkBlock}

RULES:
- Use the provided DOCUMENT EXCERPTS first.
- Keep document names and page/chunk labels where they help.
- If the excerpts do not contain enough information, say that clearly before adding general knowledge.
- Never invent citations or page numbers.
- Write as if talking directly to ${p.name || "the student"} — warm, clear, encouraging.
- Use markdown: bold key terms, short paragraphs, bullet lists where helpful.`;
}

/** System prompt for GPT in plain-chat mode (no documents). */
function buildGPTDirectSystemPrompt(p: Profile, mode: Mode, usingWebCurriculum: boolean): string {
  return `You are G&D, a warm and brilliant study tutor who genuinely cares about students.

STUDENT PROFILE:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, usingWebCurriculum)}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(p.recent_topics || []).slice(0, 8).join(", ") || "none yet"}

${modeInstruction(mode, p.exam_format || "MCQ")}

RULES:
- If unsure, say: "I'm not fully certain - please verify with your teacher, lecturer, or source material."
- Never invent citations or page numbers.
- Write as if talking directly to ${p.name || "the student"} — warm, clear, encouraging.
- Use markdown: bold key terms, short paragraphs, bullet lists where helpful.`;
}

// ─── AI callers ───────────────────────────────────────────────────────────────

/** Call DeepSeek without streaming — we need the full text before passing to GPT. */
async function callDeepSeekSync(
  apiKey: string,
  systemPrompt: string,
  messages: ChatBody["messages"],
): Promise<string> {
  const resp = await fetchWithTimeout(
    "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        stream: false,
        max_tokens: DEEPSEEK_MAX_TOKENS,
        temperature: 0.2, // Low temp — we want accurate facts, not creative flair
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    DEEPSEEK_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  return withLengthLimitNote(choice?.message?.content ?? "", choice?.finish_reason);
}

/** Call GPT-4o-mini with streaming — this is what the student sees. */
async function callGPTStream(
  apiKey: string,
  systemPrompt: string,
  messages: ChatBody["messages"],
  maxTokens: number,
): Promise<Response> {
  return fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.75, // Slightly higher — we want GPT's natural warmth
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    GPT_STREAM_START_TIMEOUT_MS,
  );
}

function gptMaxTokens(mode: Mode, hasDocs: boolean): number {
  if (mode === "Detailed") return hasDocs ? 2600 : 1800;
  if (mode === "Storytelling") return hasDocs ? 1800 : 1400;
  return hasDocs ? 1600 : 1100;
}

function normalizeRouteDecision(value: unknown, hasDocs: boolean): RouteDecision {
  if (value === "web_search") return "web_search";
  if (value === "web_curriculum") return "web_curriculum";
  if (value === "library" && hasDocs) return "library";
  return "direct";
}

async function callOpenAIRouteDecision(
  apiKey: string,
  body: ChatBody,
  hasDocs: boolean,
  webCurriculumAvailable: boolean,
): Promise<RouteDecision> {
  const lastUserMessage = [...body.messages].reverse().find((message) => message.role === "user");
  const latest = lastUserMessage?.content ?? "";
  const docNames = (body.documents ?? [])
    .slice(0, 8)
    .map((doc) => doc.file_name)
    .join("; ");

  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 80,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You route a general study chat to the cheapest correct path.
Return only JSON: {"route":"direct"|"library"|"web_search"|"web_curriculum","reason":"short"}.

Choose "direct" for greetings, wording fixes, basic explanations, general facts, or anything a tutor can answer from general knowledge.
Choose "library" only when the student clearly wants uploaded notes/materials/PDFs used, asks to complete/quote/check a sentence from a file, asks "based on my document", or selected files are needed for accuracy.
Choose "web_search" when the student explicitly asks for current/latest web information or the UI web search button is on.
Choose "web_curriculum" only when the student asks about syllabus/curriculum/study plan/high-yield topics and web curriculum is available.
If unsure between direct and library, choose library. If unsure between direct and web_curriculum, choose direct.`,
          },
          {
            role: "user",
            content: JSON.stringify({
              latest_message: latest,
              document_mode: body.documentMode ?? (hasDocs ? "smart" : "none"),
              documents_available: hasDocs,
              document_titles: docNames,
              interlink_requested: !!body.interlink,
              force_web_search: !!body.forceWebSearch,
              web_curriculum_available: webCurriculumAvailable,
            }),
          },
        ],
      }),
    },
    ROUTER_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI route error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content ?? "{}";

  try {
    const parsed = JSON.parse(content);
    return normalizeRouteDecision(parsed.route, hasDocs);
  } catch {
    return hasDocs ? "library" : "direct";
  }
}

async function callOpenAIWebCurriculumSync(
  apiKey: string,
  p: Profile,
  studentQuestion: string,
): Promise<{ text: string; sources: WebSource[] }> {
  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-search-preview",
        web_search_options: {},
        max_tokens: 700,
        messages: [
          {
            role: "system",
            content: `Search the web for current public course outline or syllabus guidance relevant to this student.
Return a concise, source-grounded study structure:
1. likely curriculum topics,
2. key learning outcomes,
3. exam-heavy points,
4. a sensible order to study.
Keep it short enough to paste into another tutor prompt.`,
          },
          {
            role: "user",
            content: `Student context:
- University: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- Question/topic: ${studentQuestion}`,
          },
        ],
      }),
    },
    WEB_CURRICULUM_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI web search error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const message = json.choices?.[0]?.message;
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  const sources = uniqueSources(
    annotations
      .map((annotation: { url_citation?: { title?: string; url?: string } }) => ({
        title: annotation.url_citation?.title || "Web source",
        url: annotation.url_citation?.url || "",
      }))
      .filter((source: WebSource) => source.url),
  );

  return {
    text: message?.content ?? "",
    sources,
  };
}

async function callOpenAIWebAnswerSync(
  apiKey: string,
  p: Profile,
  mode: Mode,
  messages: ChatBody["messages"],
): Promise<{ text: string; sources: WebSource[] }> {
  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini-search-preview",
        web_search_options: {},
        max_tokens: gptMaxTokens(mode, false),
        messages: [
          {
            role: "system",
            content: `You are G&D, a warm study tutor using web search because the student requested it.

STUDENT PROFILE:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}

${modeInstruction(mode, p.exam_format || "MCQ")}

RULES:
- Use current web results only when they are relevant to the question.
- Do not list raw URLs in the answer body; the app will show clickable source icons separately.
- If web results are weak or unrelated, say that plainly and answer from general knowledge.
- Use markdown, short paragraphs, and direct teaching language.`,
          },
          ...messages,
        ],
      }),
    },
    WEB_CURRICULUM_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI web search error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  const message = choice?.message;
  const annotations = Array.isArray(message?.annotations) ? message.annotations : [];
  const sources = uniqueSources(
    annotations
      .map((annotation: { url_citation?: { title?: string; url?: string } }) => ({
        title: annotation.url_citation?.title || "Web source",
        url: annotation.url_citation?.url || "",
      }))
      .filter((source: WebSource) => source.url),
  );

  return {
    text: withLengthLimitNote(message?.content ?? "", choice?.finish_reason),
    sources,
  };
}

function sourceMetadataSse(sources: WebSource[]): string {
  return sources.length > 0 ? `data: ${JSON.stringify({ medai_sources: sources })}\n\n` : "";
}

function textToSse(text: string, sources: WebSource[] = []): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = text.match(/.{1,24}(?:\s+|$)/gs) ?? [text];
  let index = 0;

  return new ReadableStream({
    async pull(controller) {
      if (index < chunks.length) {
        const content = chunks[index++];
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
        );
        await new Promise((resolve) => setTimeout(resolve, 12));
        return;
      }

      if (sources.length > 0) {
        controller.enqueue(encoder.encode(sourceMetadataSse(sources)));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function streamWithSources(
  upstream: ReadableStream<Uint8Array> | null,
  sources: WebSource[],
): ReadableStream<Uint8Array> | null {
  if (!upstream || sources.length === 0) return upstream;

  const reader = upstream.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  let sentSources = false;

  return new ReadableStream({
    async pull(controller) {
      while (true) {
        const newline = buffer.indexOf("\n");
        if (newline !== -1) {
          const line = buffer.slice(0, newline + 1);
          buffer = buffer.slice(newline + 1);
          if (!sentSources && line.trim() === "data: [DONE]") {
            controller.enqueue(encoder.encode(sourceMetadataSse(sources)));
            sentSources = true;
          }
          controller.enqueue(encoder.encode(line));
          return;
        }

        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer) {
            if (!sentSources && buffer.trim() === "data: [DONE]") {
              controller.enqueue(encoder.encode(sourceMetadataSse(sources)));
              sentSources = true;
            }
            controller.enqueue(encoder.encode(buffer));
          }
          if (!sentSources) controller.enqueue(encoder.encode(sourceMetadataSse(sources)));
          controller.close();
          return;
        }

        buffer += decoder.decode(value, { stream: true });
      }
    },
    cancel() {
      return reader.cancel();
    },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ChatBody;
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const candidateHasDocs = (body.documents?.length ?? 0) > 0;
    const candidateInterlink = !!body.interlink && candidateHasDocs;
    const lastUserMessage = body.messages[body.messages.length - 1];
    const priorMessages = body.messages.slice(0, -1);
    const webCurriculumAvailable = shouldUseWebCurriculumFallback(body.profile, body.messages);

    let route: RouteDecision = body.forceWebSearch
      ? "web_search"
      : candidateHasDocs
        ? "library"
        : "direct";
    if (!body.forceWebSearch && (candidateHasDocs || webCurriculumAvailable)) {
      try {
        route = await callOpenAIRouteDecision(
          OPENAI_API_KEY,
          body,
          candidateHasDocs,
          webCurriculumAvailable,
        );
      } catch (err) {
        console.error("OpenAI route decision failed:", err);
        route =
          webCurriculumAvailable &&
          questionNeedsWebCurriculumGuidance(body.messages, candidateHasDocs)
            ? "web_curriculum"
            : candidateHasDocs
              ? "library"
              : "direct";
      }
    }

    if (route === "web_curriculum" && !webCurriculumAvailable) route = "direct";

    const hasDocs = route === "library" && candidateHasDocs;
    const interlink = candidateInterlink && hasDocs;
    const useWebSearch = route === "web_search";
    const useWebCurriculum = route === "web_curriculum";

    let gptSystemPrompt: string;
    let gptMessages: ChatBody["messages"];
    let deepSeekFallbackText = "";
    const source = hasDocs ? (interlink ? "interlink" : "library") : "general";

    if (hasDocs && !DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: "DeepSeek API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let curriculumGuidance = "";
    let webSources: WebSource[] = [];

    if (useWebCurriculum) {
      try {
        const webResult = await callOpenAIWebCurriculumSync(
          OPENAI_API_KEY,
          body.profile,
          lastUserMessage.content,
        );
        curriculumGuidance = webResult.text;
        webSources = webResult.sources;
      } catch (err) {
        console.error("OpenAI web curriculum search failed:", err);
        curriculumGuidance =
          "Web course outline search was requested but unavailable. Use broad course-level priorities, organise the answer by likely learning outcomes, and tell the student this fallback is not their official school syllabus.";
      }
    }

    if (useWebSearch) {
      try {
        const webResult = await callOpenAIWebAnswerSync(
          OPENAI_API_KEY,
          body.profile,
          body.mode,
          body.messages,
        );
        return new Response(textToSse(webResult.text, webResult.sources), {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "X-Medai-Model": "gpt-web-search",
            "X-Medai-Source": "general",
          },
        });
      } catch (err) {
        console.error("OpenAI web answer failed:", err);
        return new Response(
          textToSse(
            "I couldn't complete the web search quickly enough. Try again, or turn Web off and I can answer from general knowledge.",
          ),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "text/event-stream",
              "X-Medai-Model": "web-search-timeout",
              "X-Medai-Source": "general",
            },
          },
        );
      }
    }

    if (hasDocs) {
      // Fast library path: stream GPT directly with retrieved document excerpts.
      // DeepSeek remains available below only as a rate-limit fallback.
      gptSystemPrompt = buildGPTDocumentSystemPrompt(
        body.profile,
        body.mode,
        interlink,
        useWebCurriculum,
      );
      const documentExcerpts = body
        .documents!.map(
          (doc) =>
            `=== DOCUMENT: ${doc.file_name}${doc.folder ? ` | folder: ${doc.folder}` : ""} (id:${doc.id}) ===\n${doc.excerpt}`,
        )
        .join("\n\n---\n\n");

      gptMessages = [
        ...priorMessages,
        {
          role: "user" as const,
          content: `Student question: ${lastUserMessage.content}

---
${curriculumGuidance ? `WEB CURRICULUM GUIDANCE:\n${curriculumGuidance}\n\n---\n` : ""}
DOCUMENT EXCERPTS:
${documentExcerpts}
---

Answer the student's question using the document excerpts and the style instructions in your system prompt.`,
        },
      ];
    } else {
      // ── PLAIN CHAT — GPT handles it directly ───────────────────────────────
      gptSystemPrompt = buildGPTDirectSystemPrompt(body.profile, body.mode, useWebCurriculum);
      gptMessages = curriculumGuidance
        ? [
            ...priorMessages,
            {
              role: "user" as const,
              content: `Student question: ${lastUserMessage.content}

---
WEB CURRICULUM GUIDANCE:
${curriculumGuidance}
---

Answer the student's question using the style instructions in your system prompt.`,
            },
          ]
        : body.messages;
    }

    // Stream GPT's response to the client
    const gptResp = await callGPTStream(
      OPENAI_API_KEY,
      gptSystemPrompt,
      gptMessages,
      gptMaxTokens(body.mode, hasDocs),
    );

    if (gptResp.status === 429 && DEEPSEEK_API_KEY) {
      console.warn("OpenAI rate limited; falling back to DeepSeek.");
      try {
        if (!deepSeekFallbackText) {
          deepSeekFallbackText = await callDeepSeekSync(
            DEEPSEEK_API_KEY,
            hasDocs
              ? buildDeepSeekSystemPrompt(
                  body.profile,
                  body.documents!,
                  interlink,
                  useWebCurriculum,
                )
              : buildDeepSeekDraftSystemPrompt(body.profile, useWebCurriculum),
            body.messages,
          );
        }
        return new Response(textToSse(deepSeekFallbackText, webSources), {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "X-Medai-Model": useWebCurriculum
              ? hasDocs
                ? "deepseek-web-deepseek-fallback"
                : "deepseek-web-fallback"
              : hasDocs
                ? "deepseek-deepseek-fallback"
                : "deepseek-fallback",
            "X-Medai-Source": source,
          },
        });
      } catch (err) {
        console.error("DeepSeek fallback failed:", err);
      }
    }

    if (!gptResp.ok) {
      const text = await gptResp.text();
      console.error("GPT error:", gptResp.status, text);
      const msg =
        gptResp.status === 429
          ? "Rate limit reached. Please wait a few seconds and try again."
          : gptResp.status === 401
            ? "OpenAI API key rejected. Please check your API keys in Supabase Edge Function secrets."
            : "AI provider error";
      return new Response(JSON.stringify({ error: msg }), {
        status: gptResp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(streamWithSources(gptResp.body, webSources), {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Medai-Model": useWebCurriculum
          ? "gpt-web-gpt-4o-mini"
          : hasDocs
            ? "gpt-library-fast"
            : "gpt-4o-mini",
        "X-Medai-Source": source,
      },
    });
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
