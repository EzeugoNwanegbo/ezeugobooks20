// G&D - chat edge function
//
// Provider boundary:
// - DeepSeek does the heavy lifting: uploaded-file retrieval, textbook excerpts,
//   folder classification, and factual drafts.
// - OpenAI receives DeepSeek's draft/summary and applies the selected final style.
// - OpenAI is also used for explicit web search because the app needs live
//   source metadata for reference icons.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "X-Medai-Model, X-Medai-Source, X-Medai-Fallback",
};

interface Profile {
  name?: string;
  university?: string;
  year?: string;
  course?: string | null;
  discipline?: "medicine" | "law" | null;
  study_track?: string | null;
  exam_format?: string;
  curriculum?: string | null;
  personalization_background?: string | null;
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
  image?: string;
}

interface WebAnnotation {
  type?: string;
  url_citation?: {
    end_index?: number;
    start_index?: number;
    title?: string;
    url?: string;
  };
}

type Mode = "Simplified" | "Detailed" | "Storytelling" | "Visuals";
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
const DEEPSEEK_CHAT_TIMEOUT_MS = 75_000;
const DEEPSEEK_DOCUMENT_TIMEOUT_MS = 95_000;
const GPT_REWRITE_START_TIMEOUT_MS = 45_000;
const GPT_VISUAL_SCRIPT_TIMEOUT_MS = 60_000;
const WEB_CURRICULUM_TIMEOUT_MS = 20_000;
const WEB_ANSWER_TIMEOUT_MS = 75_000;
const WEB_VISUAL_RESEARCH_TIMEOUT_MS = 75_000;
const DEEPSEEK_VISUALS_TIMEOUT_MS = 120_000;
const LENGTH_LIMIT_NOTE =
  '\n\nNote: The AI hit its response length limit before finishing. Ask "continue" and it can pick up from here.';

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

function webSourcesFromAnnotations(annotations: WebAnnotation[]): WebSource[] {
  return uniqueSources(
    annotations
      .map((annotation) => ({
        title: annotation.url_citation?.title || "Web source",
        url: annotation.url_citation?.url || "",
      }))
      .filter((source) => source.url),
  );
}

const OG_IMAGE_FETCH_TIMEOUT_MS = 2_500;
const OG_IMAGE_MAX_BYTES = 50_000;

// Best-effort og:image (falling back to twitter:image) scrape for a source
// URL. Reads only the first ~50KB of HTML so a huge page can't stall the
// request, and swallows every failure - a source simply keeps no `image`.
async function fetchOgImage(url: string): Promise<string | undefined> {
  try {
    const resp = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; GDStudyBot/1.0; +https://gd1.online) AppleWebKit/537.36",
          Accept: "text/html",
        },
      },
      OG_IMAGE_FETCH_TIMEOUT_MS,
    );

    if (!resp.ok || !resp.body) return undefined;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let html = "";
    try {
      while (html.length < OG_IMAGE_MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.cancel().catch(() => {});
    }

    const match =
      html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image(?::secure_url)?["']/i) ||
      html.match(/<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*name=["']twitter:image(?::src)?["']/i);

    const raw = match?.[1];
    if (!raw) return undefined;

    try {
      return new URL(raw, url).toString();
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

// Enriches sources with a preview image in parallel, tolerating individual
// failures/timeouts so a slow or broken page never blocks the others.
async function attachSourceImages(sources: WebSource[]): Promise<WebSource[]> {
  if (sources.length === 0) return sources;

  const results = await Promise.allSettled(sources.map((source) => fetchOgImage(source.url)));

  return sources.map((source, index) => {
    const result = results[index];
    const image = result.status === "fulfilled" ? result.value : undefined;
    return image ? { ...source, image } : source;
  });
}

function cleanWebAnswerText(text: string, annotations: WebAnnotation[]): string {
  let cleaned = text;

  const ranges = annotations
    .map((annotation) => ({
      end: annotation.url_citation?.end_index,
      start: annotation.url_citation?.start_index,
    }))
    .filter(
      (range): range is { end: number; start: number } =>
        typeof range.start === "number" &&
        typeof range.end === "number" &&
        Number.isInteger(range.start) &&
        Number.isInteger(range.end) &&
        range.start >= 0 &&
        range.end > range.start &&
        range.end <= text.length,
    )
    .sort((a, b) => b.start - a.start);

  for (const range of ranges) {
    cleaned = `${cleaned.slice(0, range.start).trimEnd()}${cleaned.slice(range.end)}`;
  }

  return cleaned
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+(?:\)[)]*)?/g, "$1")
    .replace(/\(?https?:\/\/[^\s)]+(?:\)[)]*)?/g, "")
    .replace(/\?utm_source=openai\)+/g, "")
    .replace(/\(\s*\)/g, "")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

/**
 * THE single source of truth for "who this student is". Every prompt builder
 * (fact-finding, final rewrite, web-search paths) feeds this same block to the
 * model, so the AI knows the user consistently no matter which pipeline runs.
 *
 * `memories` are durable facts the student has revealed across past chats
 * (ChatGPT-style memory). They slot in here so remembered preferences shape
 * every answer. Until the memory store is wired up this is simply empty, and
 * the block degrades gracefully to the saved profile.
 */
/**
 * G&D is specialised for medical and law students. The discipline switches the
 * AI from a generic explainer into a subject tutor that reasons with the right
 * framework (clinical reasoning vs legal IRAC), uses the right vocabulary, and
 * frames revision for the right kind of exam. Legacy users with no discipline
 * set degrade gracefully to the generic block (empty string here).
 */
function disciplineFramework(p: Profile): string {
  const track = (p.study_track ?? "").trim();
  const trackNote = track ? ` They are on the "${track}" track - pitch depth accordingly.` : "";

  if (p.discipline === "medicine") {
    return `
DISCIPLINE - MEDICINE (reason like a clinician teaching a medical student):${trackNote}
- For a disease/condition, structure the explanation as: definition -> aetiology/risk factors -> pathophysiology (mechanism) -> clinical features -> investigations -> management (first-line vs definitive) -> complications. Skip parts that do not apply.
- Lead with the high-yield, exam-relevant core. Flag classic/textbook presentations, key discriminators, and common exam pitfalls.
- Use correct medical terminology, but gloss each term in plain English the first time it appears.
- Where it fits, give a differential-diagnosis framing: what else could this be, and the single feature that best tells them apart.
- Add a short "Clinical correlation:" note when a basic-science fact maps onto a real patient scenario.
- Offer the high-yield mnemonics and memory hooks students actually use, when a genuinely useful one exists.
- Tailor exam framing to their format: MCQ -> single-best-answer discriminators and buzzwords; OSCE -> stepwise stations and what the examiner is scoring; Viva/SAQ -> concise, well-structured spoken/short answers.
- This is exam and education support, not clinical advice for a real patient. If asked to manage a real patient, add one line reminding them to follow local guidelines and senior/clinical supervision, then continue teaching.`;
  }

  if (p.discipline === "law") {
    return `
DISCIPLINE - LAW (reason like a law tutor):${trackNote}
- Analyse with IRAC/CREAC: Issue -> Rule -> Application -> Conclusion. For a problem question, apply the law to the given facts step by step; for an essay, argue a clear thesis supported by authority.
- State the governing rule with its source: statute (name + section) and leading case authority. Distinguish ratio decidendi from obiter dicta.
- Be jurisdiction-aware. If the jurisdiction matters and is not given, state which legal system you are assuming.
- For a case brief use: Facts / Issue / Holding / Ratio / Significance.
- Compare and distinguish authorities, and flag where the law is unsettled or subject to judicial/academic debate.
- Tailor exam framing to their format: problem question -> IRAC applied to the facts; essay -> structured argument with authorities; case note -> critical analysis of the judgment.
- This is educational support to build legal reasoning, not legal advice for a real dispute.`;
  }

  return "";
}

function buildStudentIdentity(
  p: Profile,
  opts: { usingWebCurriculum?: boolean; memories?: string[] } = {},
): string {
  const memories = (opts.memories ?? []).map((m) => m.trim()).filter(Boolean);
  const memoryBlock = memories.length
    ? `\nWHAT WE REMEMBER ABOUT THEM (learned from past chats - treat as true and honour it):\n${memories
        .map((m) => `- ${m}`)
        .join("\n")}`
    : "";

  // The student's own "who I am", imported from an AI they already study with.
  const background = (p.personalization_background ?? "").trim();
  const backgroundBlock = background
    ? `\nTHE STUDENT'S OWN BACKGROUND (they brought this from another study AI - treat as an accurate description of them):\n${background}`
    : "";

  const disciplineLabel = p.discipline
    ? `${p.discipline === "medicine" ? "Medicine" : "Law"}${p.study_track ? ` (${p.study_track})` : ""}`
    : p.course || "Unknown";

  return `WHO THIS STUDENT IS:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Discipline: ${disciplineLabel}
- Course / field of study: ${p.course || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, Boolean(opts.usingWebCurriculum))}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(p.recent_topics || []).slice(0, 8).join(", ") || "none yet"}${backgroundBlock}${memoryBlock}
${disciplineFramework(p)}
PERSONALIZE FOR THEM:
- Pitch the depth, vocabulary, and pace to their level and course.
- Prefer examples, analogies, and framing that fit their field of study and anything we remember they connect with.
- Where it fits naturally, tie the answer back to their weak areas and recent topics so it doubles as revision.
- Use remembered details naturally to sound like you know them - never announce that you are using saved information.`;
}

function modeInstruction(mode: Mode, examFormat: string): string {
  if (mode === "Visuals") {
    return `Present the answer in VISUALS mode.
- Turn the topic into a scene-by-scene visual explanation.
- Include the essential facts, labels, motion beats, and timing.
- Prefer concrete diagrams, animated processes, and simple visual metaphors over long prose.
- Keep text short enough to fit inside an animation canvas.`;
  }
  if (mode === "Storytelling") {
    return `Present the answer as a SHORT STORY.
- Use a relatable narrative, classroom moment, real-world scenario, or step-by-step journey through the idea.
- Weave the subject matter naturally into the story so facts stick in memory.
- 3–5 short paragraphs.`;
  }
  if (mode === "Detailed") {
    return `Present the answer in DETAILED mode.
- Cover the core idea, reasoning, examples, exceptions, and exam points.
- Use short tables or bullet lists where they help clarity.`;
  }
  // Simplified (default)
  return `Present the answer in SIMPLIFIED mode.
- HARD LIMIT: 3 short paragraphs maximum. Condense the draft - do not expand it.
- Use plain English and one real-world analogy to make the concept click.
- No jargon without an immediate plain-English explanation.
- If the research draft has a source, keep the required "Source:" line - it sits above the 3 paragraphs and does not count toward the limit. Do not drop it to save space.`;
}

/** System prompt for DeepSeek - pure fact extraction, no style. */
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

  return `You are G&D's internal document-retrieval research engine. Your job is to search the student's uploaded files and extract the exact evidence needed for a final teaching answer.

${buildStudentIdentity(p, { usingWebCurriculum })}

AVAILABLE DOCUMENTS:
${docList}

DOCUMENT CONTENT:
${docContent}
${interlinkBlock}

YOUR TASK:
1. SEARCH THOROUGHLY before answering. Read EVERY excerpt and chunk provided above from start to finish - do not stop at the first chunk that looks relevant. The exact answer is often in a later chunk than the first keyword match. Scan all of them, then decide.
2. Cross-check related chunks. If several chunks touch the topic, combine them and resolve any apparent conflicts using the most specific/complete passage.
3. Start with "Exact answer:" and give the answer in one or two clear sentences.
4. Then write "Where found:" and list document names plus page/chunk labels wherever available. If there is no page label, keep the document name and chunk/source excerpt label.
5. Then write "Evidence:" and include the relevant facts. Keep quotes short; prefer paraphrase with source labels.
6. Only after genuinely checking every excerpt, if the relevant info is truly not in the files, clearly say "I could not find an exact hit in your files" before adding any "[General knowledge]". Do not give up early.
7. Do not apply Simplified, Detailed, or Storytelling style. A later step will do the final explanation.
8. Keep document names and page/chunk labels visible. Never invent citations or page numbers.
9. If you are uncertain about anything, say so explicitly.`;
}

/** System prompt for GPT - style rewriter, human touch. */
function buildDeepSeekDirectSystemPrompt(p: Profile, usingWebCurriculum: boolean): string {
  return `You are G&D's internal factual-draft research engine. Prepare an accurate source-neutral draft for a final teaching answer.

${buildStudentIdentity(p, { usingWebCurriculum })}

YOUR TASK:
1. Start with the direct answer.
2. Give the supporting facts and reasoning.
3. Include exam-relevant points where useful.
4. If unsure, say what needs verification.
5. Never invent citations or page numbers.
6. Do not apply Simplified, Detailed, or Storytelling style. A later step will do the final explanation.`;
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
- Use a subheading per subject/folder, then a final "Connections found:" bullet list
  naming every source document used.`
    : "";

  return `You are G&D, a precision answer app for students.

You will receive a structured factual research draft prepared by G&D's internal research step.
Your job is to match the student's selected mode and turn that research draft into the final answer.

IDENTITY (strict): You are G&D, and only G&D. Never mention, name, or hint at any
underlying model, provider, or internal step - including "DeepSeek", "GPT",
"OpenAI", "the draft", "the research engine", or "as an AI language model". Do not
say the answer was "prepared" or "drafted" by anything. If the student asks what
you are or what powers you, say you are G&D. If the research draft happens to
mention any such name, silently strip it out.

${buildStudentIdentity(p, { usingWebCurriculum })}

STYLE INSTRUCTIONS:
${modeInstruction(mode, p.exam_format || "MCQ")}
${interlinkBlock}

RULES:
- Use only the research draft plus any supplied web-curriculum guidance. Do not invent new facts.
- Preserve every fact from the research summary; do not drop important evidence.
- Lead with the direct answer, then the source evidence, then the explanation.
- CITATION (mandatory, overrides every mode length/format limit): whenever the research draft contains a "Where found:" section or any document name with a page/chunk label, you MUST reproduce it as a short "Source:" line near the top of the answer, formatted exactly as "Source: <document name>, <Page N or chunk label>". This line is required even in Simplified mode and never counts against the paragraph limit. Never drop, summarise away, or bury the source in prose.
- Copy the page/chunk label verbatim from the research draft. If the draft gives a page number, cite the page; if it only gives a chunk/excerpt label, cite that label. Never omit the source because no page number was available, and never invent a page number the draft did not provide.
- The "never mention internal steps" identity rule does NOT apply to source citations: document names and page labels are the student's own uploaded material and must always be shown.
- If the summary says "[General knowledge]", keep that label so the student knows.
- Write as if you are talking directly to ${p.name || "the student"} - warm, clear, encouraging.
- Use clean, organized Markdown: headings, short paragraphs, numbered steps, hyphen bullets, and tables where helpful.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, comparison, or how parts connect - include ONE small diagram as a fenced \`\`\`mermaid code block. Keep it simple and valid: prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; use short plain node labels; no colours, CSS, or style directives. Put it where it clarifies, then keep explaining in words. If the topic is not visual, do not force a diagram.
- Never output asterisk characters. Do not use asterisks for emphasis, bullets, multiplication, footnotes, or decoration. Use plain labels, hyphen bullets, and the x symbol for multiplication.
- For maths, write equations clearly using plain text or fenced code/math blocks, define every variable, then explain the steps in order.
- If the research summary says it is uncertain about something, reflect that uncertainty honestly.`;
}

function buildGPTVisualScriptSystemPrompt(p: Profile): string {
  return `You are GPT, G&D's animation director.

You will receive the student's request plus a factual research summary prepared by DeepSeek or web search.
Create a precise animation production script for DeepSeek to code.

STUDENT PROFILE:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}

SCRIPT RULES:
- Preserve the supplied facts and source notes. Do not invent source-specific claims.
- If facts are incomplete, mark a small "Assumptions" section with safe general assumptions only.
- Build a concise educational animation: 3-6 scenes, 20-45 seconds total.
- For every scene include: duration, visual objects, labels, motion, caption text, and the learning point.
- Keep on-screen text short enough to fit inside a 16:9 animation.
- Recommend a self-contained HTML/CSS/SVG-first approach with only minimal vanilla JS if needed. No external assets, CDNs, libraries, or network calls.
- Do not request in-animation play, pause, or replay buttons. The G&D app provides the player controls outside the iframe.
- End with "Developer handoff:" followed by the exact requirements DeepSeek must implement.
- Do not write the final HTML code. DeepSeek will do that next.`;
}

function buildDeepSeekVisualAnimationSystemPrompt(p: Profile): string {
  return `You are DeepSeek, G&D's animation engineer.

GPT has already produced a storyboard and developer handoff. Your job is to create the working animation.

OUTPUT REQUIREMENTS:
1. Start with a short "Visual plan" summary in 3 bullets or fewer.
2. Then output one complete fenced code block labelled \`\`\`html.
3. The HTML must be a full, self-contained document using only HTML, CSS, SVG/canvas, and vanilla JavaScript.
4. Do not use external assets, CDNs, fonts, libraries, network calls, or framework syntax.
5. Make the animation responsive in a 16:9 canvas-like stage, with stable labels and no overlapping text.
6. Do not include play, pause, replay, reset, or timeline controls inside the HTML. The G&D app provides those controls outside the iframe.
7. Use accurate labels from the research summary and storyboard. Do not add unsupported facts.
8. Prefer CSS keyframes and inline SVG over JavaScript. If JavaScript is necessary, place it at the end of <body>, wrap it in try/catch, and render a visible first frame before any script runs.
9. The code must run inside a sandboxed iframe with srcDoc and only allow-scripts. Do not use modules, imports, top-level await, localStorage, sessionStorage, fetch, clipboard, alert, prompt, confirm, or external APIs.
10. Self-check before output: all queried elements exist, all variables are declared, canvas contexts are checked before use, and no runtime errors occur.
11. After the code block, include a brief "Source notes" section if source notes were supplied.

Student context:
- Name: ${p.name || "Student"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}`;
}

// AI callers

/** Call DeepSeek without streaming - we need the full text before passing to GPT. */
async function callDeepSeekSync(
  apiKey: string,
  systemPrompt: string,
  messages: ChatBody["messages"],
  timeoutMs = DEEPSEEK_CHAT_TIMEOUT_MS,
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
        model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-pro",
        stream: false,
        max_tokens: 8192,
        temperature: 0.2, // Low temp - we want accurate facts, not creative flair
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    timeoutMs,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`DeepSeek error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  return withLengthLimitNote(choice?.message?.content ?? "", choice?.finish_reason);
}

/** Call GPT-4o-mini with streaming - this is what the student sees. */
async function callGPTStream(
  apiKey: string,
  systemPrompt: string,
  messages: ChatBody["messages"],
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
        temperature: 0.75, // Slightly higher - we want GPT's natural warmth
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    GPT_REWRITE_START_TIMEOUT_MS,
  );
}

async function callOpenAISync({
  apiKey,
  systemPrompt,
  messages,
  maxTokens = 4096,
  temperature = 0.35,
  timeoutMs = GPT_VISUAL_SCRIPT_TIMEOUT_MS,
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatBody["messages"];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}): Promise<string> {
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
        stream: false,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    timeoutMs,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI visual script error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  return withLengthLimitNote(choice?.message?.content ?? "", choice?.finish_reason);
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
        messages: [
          {
            role: "system",
            content: `Search the web for current public course outline or syllabus guidance relevant to this student.
Return a concise, source-grounded study structure:
1. likely curriculum topics,
2. key learning outcomes,
3. exam-heavy points,
4. a sensible order to study.
Keep it short enough to paste into another answer prompt.`,
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
  const annotations = (
    Array.isArray(message?.annotations) ? message.annotations : []
  ) as WebAnnotation[];
  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: cleanWebAnswerText(message?.content ?? "", annotations),
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
        messages: [
          {
            role: "system",
            content: `You are G&D, a warm precision-answer app using web search because the student requested it.

IDENTITY (strict): You are G&D, and only G&D. Never mention or hint at any underlying model, provider, or internal step - including "DeepSeek", "GPT", "OpenAI", or "as an AI language model". If asked what you are, say you are G&D.

${buildStudentIdentity(p)}

${modeInstruction(mode, p.exam_format || "MCQ")}

RULES:
- Use current web results only when they are relevant to the question.
- Do not list raw URLs in the answer body; the app will show clickable source icons separately.
- If web results are weak or unrelated, say that plainly and answer from general knowledge.
- Use clean, organized Markdown with headings, numbered steps, hyphen bullets, and tables where useful.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, or comparison - include ONE small diagram as a fenced \`\`\`mermaid code block (prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; short plain labels; no style directives). Do not force a diagram when the topic is not visual.
- Never output asterisk characters. Use the x symbol for multiplication and plain labels instead of bold syntax.`,
          },
          ...messages,
        ],
      }),
    },
    WEB_ANSWER_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI web search error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  const message = choice?.message;
  const annotations = (
    Array.isArray(message?.annotations) ? message.annotations : []
  ) as WebAnnotation[];
  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: withLengthLimitNote(
      cleanWebAnswerText(message?.content ?? "", annotations),
      choice?.finish_reason,
    ),
    sources,
  };
}

async function callOpenAIWebVisualResearchSync(
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
        messages: [
          {
            role: "system",
            content: `Search the web only for facts needed to create an accurate educational animation.

Return a compact research brief:
1. verified core facts,
2. sequence/process steps,
3. visual objects or entities that should appear,
4. short labels suitable for an animation,
5. caveats or uncertainty.

Do not write animation code. Do not list raw URLs in the body; source metadata is handled separately.`,
          },
          {
            role: "user",
            content: `Student context:
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}

Visual request: ${studentQuestion}`,
          },
        ],
      }),
    },
    WEB_VISUAL_RESEARCH_TIMEOUT_MS,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI visual web search error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const choice = json.choices?.[0];
  const message = choice?.message;
  const annotations = (
    Array.isArray(message?.annotations) ? message.annotations : []
  ) as WebAnnotation[];
  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: withLengthLimitNote(
      cleanWebAnswerText(message?.content ?? "", annotations),
      choice?.finish_reason,
    ),
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

async function enqueueTextAsSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  text: string,
) {
  const chunks = text.match(/.{1,24}(?:\s+|$)/gs) ?? [text];

  for (const content of chunks) {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
    );
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}

function fallbackVisualAnimationText() {
  return `Visual plan
- The animation request started, but the AI animation builder did not finish in time.
- This preview keeps the Visuals panel alive instead of leaving the student with a blank result.
- Try again with Web off, a smaller selected file excerpt, or a shorter process to animate.

\`\`\`html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f8fafc; color: #0f172a; }
    .stage { width: min(920px, 96vw); aspect-ratio: 16 / 9; border: 1px solid #cbd5e1; border-radius: 18px; overflow: hidden; position: relative; background: linear-gradient(135deg, #ecfeff 0%, #fefce8 55%, #fff7ed 100%); }
    .orbit { position: absolute; inset: 16%; border: 2px dashed rgba(15, 23, 42, .22); border-radius: 999px; animation: spin 8s linear infinite; }
    .node { position: absolute; width: 76px; height: 76px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: #0891b2; color: white; box-shadow: 0 18px 40px rgba(8, 145, 178, .28); }
    .node.one { left: 14%; top: 38%; animation: pulse 2.2s ease-in-out infinite; }
    .node.two { right: 14%; top: 38%; background: #f59e0b; animation: pulse 2.2s ease-in-out infinite .6s; }
    .copy { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(70%, 560px); text-align: center; }
    h1 { margin: 0 0 10px; font-size: clamp(24px, 4vw, 46px); line-height: 1; }
    p { margin: 0; font-size: clamp(13px, 1.8vw, 18px); line-height: 1.45; color: #334155; }
    .bar { position: absolute; left: 18%; right: 18%; bottom: 13%; height: 8px; border-radius: 999px; background: rgba(15, 23, 42, .12); overflow: hidden; }
    .bar::before { content: ""; display: block; width: 42%; height: 100%; border-radius: inherit; background: #10b981; animation: load 2.8s ease-in-out infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes pulse { 50% { transform: scale(1.12); } }
    @keyframes load { 0%, 100% { transform: translateX(-10%); } 50% { transform: translateX(155%); } }
  </style>
</head>
<body>
  <main class="stage" aria-label="Visual generation fallback">
    <div class="orbit"></div>
    <div class="node one">1</div>
    <div class="node two">2</div>
    <section class="copy">
      <h1>Visual builder timed out</h1>
      <p>The app kept the animation preview alive, but the AI code step did not finish. Retry with a tighter topic or smaller file selection.</p>
    </section>
    <div class="bar"></div>
  </main>
</body>
</html>
\`\`\`

Source notes: The visual animation pipeline timed out before source-specific animation code was completed.`;
}

function visualStreamResponse(
  run: () => Promise<{ text: string; sources: WebSource[] }>,
): Response {
  const encoder = new TextEncoder();
  let heartbeat: number | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(": visuals-start\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": visuals-working\n\n"));
        } catch {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      }, 12_000);

      (async () => {
        let sources: WebSource[] = [];
        try {
          const result = await run();
          sources = result.sources;
          await enqueueTextAsSse(controller, encoder, result.text);
        } catch (err) {
          console.error("visuals pipeline failed:", err);
          await enqueueTextAsSse(controller, encoder, fallbackVisualAnimationText());
        } finally {
          if (heartbeat !== undefined) clearInterval(heartbeat);
          if (sources.length > 0) {
            controller.enqueue(encoder.encode(sourceMetadataSse(sources)));
          }
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.close();
        }
      })();
    },
    cancel() {
      if (heartbeat !== undefined) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "X-Medai-Model": "gpt-script-to-deepseek-visuals",
      "X-Medai-Source": "visuals",
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

async function openAIRewriteResponse({
  apiKey,
  systemPrompt,
  messages,
  model,
  source,
  sources,
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatBody["messages"];
  model: string;
  source: string;
  sources: WebSource[];
}): Promise<Response> {
  const gptResp = await callGPTStream(apiKey, systemPrompt, messages);

  if (!gptResp.ok) {
    const text = await gptResp.text();
    console.error("OpenAI rewrite error:", gptResp.status, text);
    const msg =
      gptResp.status === 429
        ? "OpenAI final explanation is rate limited. Please wait a few seconds and try again."
        : gptResp.status === 401
          ? "OpenAI API key rejected. Please check your Supabase Edge Function secrets."
          : "OpenAI final explanation failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: gptResp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(streamWithSources(gptResp.body, sources), {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "X-Medai-Model": model,
      "X-Medai-Source": source,
    },
  });
}

async function createVisualAnimationText({
  deepSeekApiKey,
  openAIApiKey,
  profile,
  priorMessages,
  studentQuestion,
  researchText,
  researchSource,
}: {
  deepSeekApiKey: string;
  openAIApiKey: string;
  profile: Profile;
  priorMessages: ChatBody["messages"];
  studentQuestion: string;
  researchText: string;
  researchSource: "library" | "web" | "general";
}): Promise<string> {
  const visualScript = await callOpenAISync({
    apiKey: openAIApiKey,
    systemPrompt: buildGPTVisualScriptSystemPrompt(profile),
    messages: [
      ...priorMessages.slice(-6),
      {
        role: "user" as const,
        content: `Student visual request:
${studentQuestion}

Research source: ${researchSource}

Factual research summary:
"""
${researchText}
"""

Create the animation production script for DeepSeek.`,
      },
    ],
    maxTokens: 5000,
    temperature: 0.3,
    timeoutMs: GPT_VISUAL_SCRIPT_TIMEOUT_MS,
  });

  const finalAnimation = await callDeepSeekSync(
    deepSeekApiKey,
    buildDeepSeekVisualAnimationSystemPrompt(profile),
    [
      {
        role: "user" as const,
        content: `Student visual request:
${studentQuestion}

Research source: ${researchSource}

Factual research summary:
"""
${researchText}
"""

GPT animation script:
"""
${visualScript}
"""

Create the final animation package now.`,
      },
    ],
    DEEPSEEK_VISUALS_TIMEOUT_MS,
  );

  return finalAnimation;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as ChatBody;
    const DEEPSEEK_API_KEY = Deno.env.get("DEEPSEEK_API_KEY");
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");

    const candidateHasDocs = (body.documents?.length ?? 0) > 0;
    const candidateInterlink = !!body.interlink && candidateHasDocs;
    const lastUserMessage = body.messages[body.messages.length - 1];
    const priorMessages = body.messages.slice(0, -1);
    const webCurriculumAvailable = shouldUseWebCurriculumFallback(body.profile, body.messages);

    let route: RouteDecision = body.forceWebSearch ? "web_search" : "direct";
    if (!body.forceWebSearch) {
      route = candidateHasDocs
        ? "library"
        : webCurriculumAvailable && questionNeedsWebCurriculumGuidance(body.messages, false)
          ? "web_curriculum"
          : "direct";
    }

    if (route === "web_curriculum" && !webCurriculumAvailable) route = "direct";

    const hasDocs = route === "library" && candidateHasDocs;
    const interlink = candidateInterlink && hasDocs;
    const useWebSearch = route === "web_search";
    const useWebCurriculum = route === "web_curriculum";

    const source = hasDocs ? (interlink ? "interlink" : "library") : "general";

    if (!OPENAI_API_KEY) {
      return new Response(JSON.stringify({ error: "OpenAI API key not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((!useWebSearch || body.mode === "Visuals") && !DEEPSEEK_API_KEY) {
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

    if (body.mode === "Visuals") {
      return visualStreamResponse(async () => {
        let researchText = "";
        let researchSource: "library" | "web" | "general" = "general";
        let visualSources = webSources;

        if (useWebSearch) {
          const webResult = await callOpenAIWebVisualResearchSync(
            OPENAI_API_KEY,
            body.profile,
            lastUserMessage.content,
          );
          researchText = webResult.text;
          researchSource = "web";
          visualSources = webResult.sources;
        } else if (hasDocs) {
          const deepSeekMessages = [
            ...priorMessages,
            {
              role: "user" as const,
              content: `Student visual request: ${lastUserMessage.content}

---
${curriculumGuidance ? `WEB CURRICULUM GUIDANCE:\n${curriculumGuidance}\n\n---\n` : ""}

Extract the exact evidence needed for an educational animation.
Include:
- the direct answer,
- source locations from uploaded files,
- the process or sequence,
- visual objects/entities,
- short labels that could appear on screen,
- any uncertainty.

Do not write animation code yet.`,
            },
          ];

          researchText = await callDeepSeekSync(
            DEEPSEEK_API_KEY!,
            buildDeepSeekSystemPrompt(body.profile, body.documents!, interlink, useWebCurriculum),
            deepSeekMessages,
            DEEPSEEK_DOCUMENT_TIMEOUT_MS,
          );
          researchSource = "library";
        } else {
          const deepSeekMessages = curriculumGuidance
            ? [
                ...priorMessages,
                {
                  role: "user" as const,
                  content: `Student visual request: ${lastUserMessage.content}

---
WEB CURRICULUM GUIDANCE:
${curriculumGuidance}
---

Prepare the factual research brief for an educational animation. Include the process or sequence, visual objects/entities, short on-screen labels, and any uncertainty. Do not write animation code yet.`,
                },
              ]
            : [
                ...priorMessages,
                {
                  role: "user" as const,
                  content: `Student visual request: ${lastUserMessage.content}

Prepare the factual research brief for an educational animation. Include the process or sequence, visual objects/entities, short on-screen labels, and any uncertainty. Do not write animation code yet.`,
                },
              ];

          researchText = await callDeepSeekSync(
            DEEPSEEK_API_KEY!,
            buildDeepSeekDirectSystemPrompt(body.profile, useWebCurriculum),
            deepSeekMessages,
            DEEPSEEK_CHAT_TIMEOUT_MS,
          );
        }

        const finalAnimation = await createVisualAnimationText({
          deepSeekApiKey: DEEPSEEK_API_KEY!,
          openAIApiKey: OPENAI_API_KEY,
          profile: body.profile,
          priorMessages,
          studentQuestion: lastUserMessage.content,
          researchText:
            curriculumGuidance && !researchText.includes(curriculumGuidance)
              ? `${researchText}\n\nWeb curriculum guidance:\n${curriculumGuidance}`
              : researchText,
          researchSource,
        });

        return { text: finalAnimation, sources: visualSources };
      });
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
            "Web search took too long to finish. Try again in a moment, or turn Web off and I can answer from general knowledge.",
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
      const deepSeekMessages = [
        ...priorMessages,
        {
          role: "user" as const,
          content: `Student question: ${lastUserMessage.content}

---
${curriculumGuidance ? `WEB CURRICULUM GUIDANCE:\n${curriculumGuidance}\n\n---\n` : ""}

Answer the student's question by finding the exact relevant evidence in the uploaded document content first. Show where it came from, then explain using the style instructions in your system prompt.`,
        },
      ];

      const deepSeekText = await callDeepSeekSync(
        DEEPSEEK_API_KEY!,
        buildDeepSeekSystemPrompt(body.profile, body.documents!, interlink, useWebCurriculum),
        deepSeekMessages,
        DEEPSEEK_DOCUMENT_TIMEOUT_MS,
      );

      return openAIRewriteResponse({
        apiKey: OPENAI_API_KEY,
        systemPrompt: buildGPTRewriterSystemPrompt(
          body.profile,
          body.mode,
          interlink,
          useWebCurriculum,
        ),
        messages: [
          ...priorMessages,
          {
            role: "user" as const,
            content: `Student question: ${lastUserMessage.content}

Research draft (document retrieval):
"""
${deepSeekText}
"""

${curriculumGuidance ? `Web curriculum guidance:\n${curriculumGuidance}\n\n` : ""}Now produce the final answer STRICTLY following the ${body.mode} mode rules in your system prompt. Do not exceed the length and structure limits for that mode. Do not add facts outside the research draft. Never mention the research draft, DeepSeek, GPT, OpenAI, or any internal step in your answer.`,
          },
        ],
        model: useWebCurriculum
          ? "deepseek-to-openai-library-web-curriculum"
          : "deepseek-to-openai-library",
        source,
        sources: webSources,
      });
    } else {
      // Plain chat: DeepSeek prepares the factual draft, OpenAI applies the selected mode.
      const deepSeekMessages = curriculumGuidance
        ? [
            ...priorMessages,
            {
              role: "user" as const,
              content: `Student question: ${lastUserMessage.content}

---
WEB CURRICULUM GUIDANCE:
${curriculumGuidance}
---

Prepare the factual draft for a final teaching answer.`,
            },
          ]
        : body.messages;

      const deepSeekText = await callDeepSeekSync(
        DEEPSEEK_API_KEY!,
        buildDeepSeekDirectSystemPrompt(body.profile, useWebCurriculum),
        deepSeekMessages,
        DEEPSEEK_CHAT_TIMEOUT_MS,
      );

      return openAIRewriteResponse({
        apiKey: OPENAI_API_KEY,
        systemPrompt: buildGPTRewriterSystemPrompt(
          body.profile,
          body.mode,
          false,
          useWebCurriculum,
        ),
        messages: [
          ...priorMessages,
          {
            role: "user" as const,
            content: `Student question: ${lastUserMessage.content}

Research draft (factual):
"""
${deepSeekText}
"""

${curriculumGuidance ? `Web curriculum guidance:\n${curriculumGuidance}\n\n` : ""}Now produce the final answer STRICTLY following the ${body.mode} mode rules in your system prompt. Do not exceed the length and structure limits for that mode. Do not add facts outside the research draft. Never mention the research draft, DeepSeek, GPT, OpenAI, or any internal step in your answer.`,
          },
        ],
        model: useWebCurriculum ? "deepseek-to-openai-web-curriculum" : "deepseek-to-openai",
        source,
        sources: webSources,
      });
    }
  } catch (e) {
    console.error("chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
