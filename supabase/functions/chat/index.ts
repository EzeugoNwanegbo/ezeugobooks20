// G&D - chat edge function
//
// Provider boundary:
// - DeepSeek does the heavy lifting: uploaded-file retrieval, textbook excerpts,
//   folder classification, and factual drafts.
// - OpenAI receives DeepSeek's draft/summary and applies the selected final style.
// - OpenAI is also used for explicit web search because the app needs live
//   source metadata for reference icons.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

type Mode = "Simplified" | "Detailed" | "Detailed+" | "Storytelling" | "Visuals";
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
  // OPT-IN, DEFAULTS OFF. When true, the document route answers in ONE streamed
  // call instead of the blocking research draft + styling rewrite. See the
  // `hasDocs` branch in the handler for why this is a request flag and not a
  // deploy-time switch: this one function serves the website AND the native
  // mobile app (gandd-mobile/lib/chat-client.ts), there is no staging
  // deployment, and the owner wants a side-by-side against the real production
  // function before students meet it. Absent or false must behave exactly as
  // the two-hop pipeline always has.
  singleHop?: boolean;
}

// ── Progress frames: the wait, narrated ─────────────────────────────────────
//
// These types are a deliberate MIRROR of the wire format defined and documented
// in src/components/answer-timeline.tsx - that file owns the schema, the
// reducer, and the ordering contract. Edge Functions deploy separately from the
// frontend and cannot import browser code, which is the same reason
// CHAT_COOKIE_COST is duplicated further down. If the two ever disagree, the
// component is the source of truth.
//
// Frames ride the existing SSE stream under a top-level key, exactly like
// `medai_sources`, because both clients test top-level keys BEFORE reading
// `choices[0].delta.content`. An old client therefore discards a progress frame
// silently: it is not an array under `medai_sources`, and it carries no delta,
// so it falls through both branches without touching the answer text.
//
// The ordering contract this file must keep (from the component's own docs):
//   - a step's `step` frame goes out BEFORE any `step_detail` for it,
//   - steps are closed EXPLICITLY (a new active step does not finish the last),
//   - the ids "reading", "sources", "web", "writing" are reused so a late first
//     frame merges into the client's scripted fallback rows,
//   - every frame is flushed on its own - batched with the first token they are
//     worth nothing,
//   - the label is ours to author, count included. The client never composes it.
type AnswerTimelineIcon =
  | "reading"
  | "file"
  | "retrieval"
  | "search"
  | "web"
  | "writing"
  | "thinking";

type AnswerStepStatus = "pending" | "active" | "done" | "empty" | "failed";

type AnswerProgressEvent =
  | {
      type: "step";
      id: string;
      label?: string;
      icon?: AnswerTimelineIcon;
      status?: AnswerStepStatus;
      note?: string;
      error?: string;
      detailLabel?: string;
      detailIcon?: AnswerTimelineIcon;
    }
  | {
      type: "step_detail";
      stepId: string;
      text: string;
      label?: string;
      icon?: AnswerTimelineIcon;
    };

function progressSse(...events: AnswerProgressEvent[]): string {
  return events.map((event) => `data: ${JSON.stringify({ medai_progress: event })}\n\n`).join("");
}

/**
 * An error the student is allowed to read.
 *
 * Thrown from inside a stream that has ALREADY committed its 200 headers, where
 * returning a JSON error response is no longer possible. The shell below turns
 * it into a `medai_error` frame; provider strings and status codes stay in the
 * logs, as everywhere else in this file.
 */
class StudentFacingError extends Error {
  /** Upstream HTTP status, when there was one. Kept for the logs: a stream that
   *  has already sent 200 cannot report it as a status any more, so this is
   *  where it survives. */
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

// OpenAI answer models. GPT-5 replaced the 4o line: `gpt-4o-mini-search-preview`
// was shut down on 23 July 2026, and the GPT-5 family rejects `temperature` and
// `max_tokens` outright (use `max_completion_tokens`), so neither the old model
// names nor the old sampling parameters survive anywhere in this file.
//
// Two tiers, picked per mode: the deep tier costs ~4x input / 3x output, which
// is worth it for the long structured answers and not for a three-paragraph one.
const OPENAI_MODEL_FAST = "gpt-5-nano"; // $0.05 / $0.40 per 1M
const OPENAI_MODEL_DEEP = "gpt-5.6-luna"; // $0.20 / $1.20 per 1M

function answerModel(mode: Mode): string {
  return mode === "Detailed" || mode === "Detailed+" ? OPENAI_MODEL_DEEP : OPENAI_MODEL_FAST;
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

  // A BARE TOPIC ("pharmacology", "cardiac cycle") is a request for direction
  // and genuinely wants the curriculum lookup. A short QUESTION ("what is a
  // nephron?") is a request for an answer, and a greeting is neither.
  //
  // This used to be a flat "six words or fewer with no documents", which caught
  // every one of those alike - so typing "hi" fired a web search, then a full
  // blocking research draft, then the styling stream. Three model round trips
  // before a single character reached the student, to say hello back.
  const trimmed = content.trim();
  if (hasDocs || !trimmed || isSmallTalk(trimmed)) return false;
  if (trimmed.split(/\s+/).length > 6) return false;
  if (trimmed.endsWith("?")) return false;
  return !/^(what|whats|what's|who|whose|when|where|why|how|which|is|are|was|were|does|do|did|can|could|should|would|will|define|explain|list|name|give|tell|compare|contrast|describe|summarise|summarize)\b/i.test(
    trimmed,
  );
}

/**
 * Is this ordinary conversation rather than a study question?
 *
 * Greetings, thanks, acknowledgements, sign-offs, and "what are you" questions.
 * These do not need retrieval, a research draft, or a styling pass - they need
 * one short answer, quickly. Deliberately conservative: anything that is not
 * clearly small talk falls through to the full pipeline, because answering a
 * real question with the fast path would be the worse mistake.
 */
function isSmallTalk(content: string): boolean {
  const t = content
    .trim()
    .toLowerCase()
    .replace(/[!.,\u2019']/g, "");
  if (!t || t.split(/\s+/).length > 6) return false;
  // A greeting may carry an address after it - "hello there", "hi gd". Without
  // the optional tail, "hello there" missed here AND then failed the bare-topic
  // test below it, so a two-word hello went out to a web search.
  const greeting =
    /^(hi|hey+|hello+|yo|sup|hiya|howdy|greetings|good\s+(morning|afternoon|evening|day)|gm|gn)(\s+(there|gd|g\s*&\s*d|guys|team|again|mate|man))?$/;
  const chatter =
    /^(how\s+are\s+you( doing)?|how\s+far|hows\s+it\s+going|whats\s+up|wassup|thank\s*(you|s)|thanks?|thx|ty|much\s+appreciated|ok(ay)?|kk|cool|nice|great|awesome|perfect|lovely|got\s+it|understood|alright|lol|haha+|bye|goodbye|see\s+you|later|good\s*night|who\s+are\s+you|what\s+are\s+you|what\s+can\s+you\s+do|what\s+do\s+you\s+do|who\s+made\s+you|test|testing)$/;
  return greeting.test(t) || chatter.test(t);
}

// ─── Prompt builders ──────────────────────────────────────────────────────────

/**
 * G&D used to hard-branch this into a medicine block and a law block, chosen by
 * a discipline picker in onboarding. That picker is gone - the product is free
 * for all fields now, and a fixed two-way switch could only ever serve two of
 * them. What replaced it is not a weaker generic block; it is the same demand
 * for real disciplinary reasoning, with the choice of framework handed to the
 * model and driven by the student's own free-text course.
 *
 * The exemplars below are deliberately concrete. A vague instruction to "use
 * the conventions of their field" produces a generic explainer wearing the
 * subject's vocabulary; naming what the framework actually looks like in
 * several fields shows the model the standard being asked for, and it
 * generalises from there. A medicine student still gets pathophysiology and
 * differentials, a law student still gets IRAC - and an engineering or
 * economics student now gets theirs too.
 *
 * `discipline` still exists on the row and is deliberately ignored here.
 */
function fieldFramework(p: Profile): string {
  const course = (p.course ?? "").trim();
  const track = (p.study_track ?? "").trim();
  const field = course || "their field";
  const trackNote = track ? ` They are on the "${track}" track - pitch depth accordingly.` : "";

  return `
HOW TO REASON IN THEIR FIELD (${field}):${trackNote}
- Answer the way a strong tutor in ${field} would, using that field's own reasoning framework, structure, and vocabulary - not a general-purpose explanation with the subject's words sprinkled on top.
- Pick the framework the field actually uses, and follow it. For example: medicine and health -> definition, aetiology, pathophysiology, clinical features, investigations, management (first-line vs definitive), complications, plus a differential and the single feature that best separates the candidates; law -> IRAC/CREAC with the governing statute (name + section) and leading authority named, ratio distinguished from obiter, and the jurisdiction stated when it matters; engineering and the physical sciences -> governing principle, assumptions, derivation, worked numbers, units, sanity check; economics and business -> model, assumptions, mechanism, evidence, limitations; humanities -> thesis, evidence, strongest counter-argument, conclusion. If their field is not in that list, use its equivalent - every field has one.
- Use the field's correct technical terminology, and gloss each term in plain English the first time it appears.
- Lead with the high-yield, exam-relevant core. Flag the classic presentations or leading cases, the key discriminators, and the mistakes examiners see most often.
- Add a short applied note ("in practice:", "clinical correlation:", "worked example:") when an abstract fact maps onto something concrete in their field.
- Offer the mnemonics and memory hooks students in that field actually use, where a genuinely useful one exists. Never invent a forced one.
- Tailor exam framing to their format: MCQ -> single-best-answer discriminators and buzzwords; OSCE or practical -> stepwise stations and what the examiner is scoring; viva/SAQ -> concise, well-structured spoken or short answers; essay -> a clear thesis argued from authority; problem question -> the framework applied to the given facts step by step; calculation -> full working, units, and a check.
- This is exam and education support, not professional advice on a real case. If they ask you to manage a real patient, client, dispute, or safety-critical design, add one line pointing them to local guidelines and qualified supervision, then carry on teaching.`;
}

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

  return `WHO THIS STUDENT IS:
- Name: ${p.name || "Student"}
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Course / field of study: ${p.course || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- ${curriculumRule(p, Boolean(opts.usingWebCurriculum))}
- Weak areas: ${(p.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(p.recent_topics || []).slice(0, 8).join(", ") || "none yet"}${backgroundBlock}${memoryBlock}
${fieldFramework(p)}
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
  if (mode === "Detailed+") {
    // These notes are also exported to PDF client-side, so the structure below is
    // deliberately predictable: a title, then headed sections, then takeaways.
    return `Present the answer as a complete set of STUDY NOTES the student could revise from and hand in. Structure matters as much as content here - this is the mode people save and print.
- Open with a single "# " Markdown title naming the topic. No preamble, no greeting before it.
- Then a short "Summary" section: 2-4 sentences on what the topic is and why it matters.
- Then the body, broken into clearly headed "## " sections that follow the logic of the topic (definitions, mechanism/process, classification, key features, causes, management, exceptions, worked example - whichever genuinely apply). Use "### " subsections where a section has parts.
- Inside sections, prefer numbered steps for processes, hyphen bullets for lists of features, and a Markdown table when you are comparing two or more things across the same attributes.
- Bold nothing (no asterisks anywhere) - rely on headings and lists for structure.
- Include a "## Key terms" section: each term on its own hyphen bullet as "Term - one-line definition".
- Include a "## Key takeaways" section near the end: 4-7 hyphen bullets, each a single sentence a student could recall in an exam.
- If the assessment format is ${examFormat}, add a short "## Exam pointers" section naming what is typically asked and the traps.
- Be thorough but not padded: every line should carry information. No filler sentences, no "in conclusion" waffle.
- Keep the required "Source:" line at the very top if the research draft has one, above the title.`;
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
  // Detailed+ streams this engine's output straight to the student, so the
  // draft scaffolding ("Exact answer:", "Where found:", "a later step will
  // explain") has to be swapped for an instruction to write the answer itself.
  // Without this the two prompts contradict each other and the scaffolding
  // leaks into the notes.
  opts: { finalAnswer?: boolean } = {},
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

  // Steps 1-2 (search everything, cross-check) are what makes retrieval good and
  // are wanted either way. Only the output contract changes.
  const outputTask = opts.finalAnswer
    ? `3. Then write the student's final answer yourself, following the STYLE INSTRUCTIONS that appear below this section. Nothing runs after you - do not produce a draft, a summary for another step, or any "Exact answer:" / "Where found:" / "Evidence:" scaffolding.
4. Put the source on the very first line as "Source: <document name>, Page N", copied verbatim from the excerpts, above everything else. If an excerpt carries no page number, cite the document name alone - never invent a page, and never cite an internal chunk or excerpt index.
4b. TWO PAGE NUMBERS. Excerpt labels look like "[Page 47 | Book page 23]". 47 is the sheet in the PDF; 23 is the number printed on the page itself, and they differ by the length of the book's front matter. When a label carries both, cite both - "Source: <document name>, PDF page 47 (book page 23)" - because a student reading the PDF needs the first and a student holding the physical book needs the second. When a label carries only "[Page N]", cite that one alone and do not invent the other.
5. Only after genuinely checking every excerpt, if the relevant info is truly not in the files, say so plainly in the answer before adding anything from general knowledge. Do not give up early.`
    : `3. Start with "Exact answer:" and give the answer in one or two clear sentences.
4. Then write "Where found:" and list document names plus page numbers wherever available, copying BOTH numbers when a label shows "[Page 47 | Book page 23]" (PDF sheet and the page printed on the page). If an excerpt has no page number, give the document name alone - never cite an internal chunk or excerpt index.
5. Then write "Evidence:" and include the relevant facts. Keep quotes short; prefer paraphrase with source labels.
6. Only after genuinely checking every excerpt, if the relevant info is truly not in the files, clearly say "I could not find an exact hit in your files" before adding any "[General knowledge]". Do not give up early.
7. Do not apply Simplified, Detailed, Detailed+, or Storytelling style. A later step will do the final explanation.`;

  const role = opts.finalAnswer
    ? `You are G&D. You search the student's uploaded files and then write their answer from what you find.`
    : `You are G&D's internal document-retrieval research engine. Your job is to search the student's uploaded files and extract the exact evidence needed for a final teaching answer.`;

  return `${role}

${buildStudentIdentity(p, { usingWebCurriculum })}

AVAILABLE DOCUMENTS:
${docList}

DOCUMENT CONTENT:
${docContent}
${interlinkBlock}

YOUR TASK:
1. SEARCH THOROUGHLY before answering. Read EVERY excerpt provided above from start to finish - do not stop at the first passage that looks relevant. The exact answer is often in a later excerpt than the first keyword match. Scan all of them, then decide.
2. Cross-check related excerpts. If several touch the topic, combine them and resolve any apparent conflicts using the most specific/complete passage.
${outputTask}
8. Keep document names and page numbers visible. Never invent citations or page numbers, and never surface internal chunk or excerpt indexes - they mean nothing to a student.
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
6. Do not apply Simplified, Detailed, Detailed+, or Storytelling style. A later step will do the final explanation.`;
}

/**
 * Detailed+ writes its own notes - and, behind the single-hop flag, so does
 * every other mode on the document route.
 *
 * Every other mode runs research -> styling, because the styling pass adds the
 * warmth and shaping that a research draft has none of. Detailed+ does not want
 * that: its output is structural - a title, headed sections, tables, key terms,
 * takeaways - which is what the research step is already good at. Sending a full
 * set of notes through a second model doubled the most expensive output in the
 * pipeline and added a hop before the first token.
 *
 * So the research engine writes the final answer here, which means it inherits
 * everything the styling prompt used to own: the identity rule, the citation
 * requirement, and the output bans. Those are not optional - this text goes
 * straight to the student.
 *
 * SECOND CALLER, SAME REASONING. `body.singleHop` now points the document route
 * through here for Simplified, Detailed and Storytelling too, for the latency
 * reason rather than the structural one (the hop it removes is 8-25 seconds of
 * blank screen). That caller appends SINGLE_HOP_CONTRACT, because those modes
 * bring two things Detailed+ never had: a hard length limit, and therefore a
 * length limit that could argue with the mandatory Source line. The only thing
 * that changes in HERE is the closing voice line - Detailed+ still gets its
 * "notes stay structural", which would be wrong advice for a three-paragraph
 * Simplified answer. Every other byte of this prompt is shared, and Detailed+'s
 * output must stay identical to what is in production.
 */
function buildDeepSeekNotesSystemPrompt(
  p: Profile,
  mode: Mode,
  interlink: boolean,
  usingWebCurriculum: boolean,
  docs: DocumentCtx[] | null,
): string {
  const interlinkBlock = interlink
    ? `
INTERLINK STYLE:
- Explicitly highlight how concepts from different subjects connect.
- Use a subheading per subject/folder, then a final "Connections found:" bullet list naming every source document used.`
    : "";

  const groundingBlock = docs?.length
    ? `
GROUNDING (mandatory):
- Build the notes from the document content supplied below. Do not add facts that are not in it.
- Reproduce the source as a "Source: <document name>, Page N" line as the very first line, above the title. Copy the page number verbatim; never invent one. If the draft gives both a PDF page and a book page, keep both as "PDF page 47 (book page 23)". If the draft gives no page, cite the document name alone.
- If the material does not cover part of the question, say so plainly in the notes rather than filling the gap from general knowledge.`
    : `
GROUNDING:
- No uploaded document is in scope, so answer from general knowledge and do not fabricate a "Source:" line.`;

  // Byte-identical to what production sends for Detailed+; the alternative is
  // for the modes that answer in three paragraphs rather than in sections.
  const voiceLine =
    mode === "Detailed+"
      ? `Write as if you are talking directly to ${p.name || "the student"} - warm and clear, but the notes themselves stay structural. No filler, no "in conclusion" waffle.`
      : `Write as if you are talking directly to ${p.name || "the student"} - warm, clear and encouraging, in the shape the STYLE INSTRUCTIONS above ask for. No filler, no "in conclusion" waffle.`;

  return `You are G&D, a precision study app for medical and law students. You are writing the student's final answer yourself - nothing runs after you.

IDENTITY (strict): You are G&D, and only G&D. Never mention, name, or hint at any underlying model, provider, or internal step - including "DeepSeek", "GPT", "OpenAI", "the draft", or "as an AI language model". If the student asks what you are or what powers you, say you are G&D.

${buildStudentIdentity(p, { usingWebCurriculum })}

STYLE INSTRUCTIONS:
${modeInstruction(mode, p.exam_format || "MCQ")}
${interlinkBlock}
${groundingBlock}

OUTPUT RULES:
- Never output asterisk characters. Do not use asterisks for emphasis, bullets, multiplication, footnotes, or decoration. Use plain labels, hyphen bullets, and the x symbol for multiplication.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, or comparison - include ONE small diagram as a fenced \`\`\`mermaid code block (prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; short plain labels; no style directives). Do not force a diagram when the topic is not visual.
- Mermaid label syntax is strict: any node label containing punctuation (parentheses, brackets, colons, slashes, commas) must be wrapped in double quotes, e.g. A["Stage 2 (deep sleep)"]. Unquoted punctuation is a syntax error and the diagram will not render.
- ${voiceLine}`;
}

/**
 * The two things the retired styling hop used to own, handed over explicitly.
 *
 * Appended ONLY on the opt-in single-hop document route (`body.singleHop`).
 * Detailed+ has always answered in one hop and does not get this block, so its
 * prompt stays byte-identical to what is in production.
 *
 * 1. LENGTH. Every mode's length rule already travels inside
 *    modeInstruction() - "HARD LIMIT: 3 short paragraphs maximum" for
 *    Simplified, "3-5 short paragraphs" for Storytelling - so it is present in
 *    both pipelines. What is NOT present any more is the pressure that actually
 *    made it stick: a second model whose entire job was to condense somebody
 *    else's draft, plus a final user turn telling it not to exceed the limit.
 *    A retrieval engine instructed to read every excerpt from start to finish
 *    is being pulled the other way, and left alone it will hand a Simplified
 *    student six paragraphs of thorough. The wording below is deliberate about
 *    which instruction wins.
 * 2. CITATION versus length. buildGPTRewriterSystemPrompt's citation rule opens
 *    "(mandatory, overrides every mode length/format limit)" and spells out
 *    that the Source line "never counts against the paragraph limit". The
 *    finalAnswer branch of buildDeepSeekSystemPrompt (items 4 and 4b) carries
 *    the same citation FORMAT - first line, verbatim page, both numbers when
 *    the label has two, never a chunk index - but it has never had to state
 *    that exemption, because the only mode that used it (Detailed+) has no
 *    length limit to conflict with. Simplified does. Without this line the
 *    three-paragraph cap and the mandatory Source line are two rules in direct
 *    competition, and the model is free to resolve it by dropping the citation
 *    - which is the single worst thing this route could do.
 */
const SINGLE_HOP_CONTRACT = `SINGLE PASS - READ THIS LAST:
- Nothing runs after you. There is no later step to shorten, restructure, or re-voice this, so the STYLE INSTRUCTIONS above describe the FINISHED answer, not raw material for one. Their length and structure limits are hard limits: searching thoroughly is your job, writing at length is not. If a limit says three paragraphs, three paragraphs is the whole answer.
- The "Source:" line is the one exception, and it overrides every length limit above. It is required whenever the excerpts carry a document name, it goes on the very first line, and it never counts toward a paragraph, bullet, or word count. Never drop it to save space, never bury it in prose, and never summarise it away.`;

/**
 * The small-talk voice. No research draft, no citations, no mode styling.
 *
 * Deliberately NOT built on buildStudentIdentity(): that block carries the full
 * field-reasoning framework, and handing it to a model that was asked "hi"
 * produces a lecture. A greeting gets a person, not a syllabus.
 *
 * This prompt also owns the one place G&D explains itself, under the owner's
 * rule: say what G&D is for AFTER answering, never as a greeting of its own,
 * and never twice in the same conversation.
 */
function buildConversationalSystemPrompt(p: Profile): string {
  const who = [
    p.name ? `They are called ${p.name}.` : "",
    p.course ? `They study ${p.course}.` : "",
    p.university ? `They are at ${p.university}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return `You are G&D, a study companion for students. ${who}

HOW TO REPLY HERE:
- This is ordinary conversation, not a study question. Be calm, warm and brief - one or two short sentences is almost always right.
- Answer what they actually said. Do not turn a greeting into a lecture, do not open with a heading, a bulleted list, a diagram or a wall of text, and never ask them to upload anything before you will talk to them.
- Sound like a person who is glad they turned up, not like a product tour.
- If they ask what you are or what you can do, say it plainly and in your own words: you are G&D, built to read a student's own material - lecture notes, past papers, whole textbooks - and answer from it with the page it came from, a search engine for their own books. Add that you also answer ordinary questions with no file at all.
- CLOSING NOTE - at most ONCE in a conversation, and only when it genuinely fits: after your reply, you may add one short friendly line that G&D is at its best with their own material to search. Never say it twice. Never say it if any earlier reply in this conversation already did. Never let it become the whole reply, and never repeat it to someone who has already uploaded something.
- Never mention, name or hint at any underlying model, provider or internal step. If asked what powers you, you are G&D.
- Never output asterisk characters.`;
}

function buildGPTRewriterSystemPrompt(
  p: Profile,
  mode: Mode,
  interlink: boolean,
  usingWebCurriculum: boolean,
  // Whether any of the student's own files are in play for THIS answer. Without
  // it the prompt talked about documents and citations either way, which is how
  // a plain question with nothing uploaded ended up being answered as though a
  // file had failed to produce the answer.
  hasDocs: boolean,
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
- CITATION (mandatory, overrides every mode length/format limit): whenever the research draft contains a "Where found:" section or any document name with a page number, you MUST reproduce it as a short "Source:" line near the top of the answer, formatted exactly as "Source: <document name>, Page N". This line is required even in Simplified mode and never counts against the paragraph limit. Never drop, summarise away, or bury the source in prose.
- TWO PAGE NUMBERS, when the draft has them: write "Source: <document name>, PDF page 47 (book page 23)". The first is where it sits in the file, the second is the number printed on the page - a scanned book's front matter makes them differ, and a student with the physical book can only use the second. Never invent the book page when the draft gives only one number.
- Copy the page number verbatim from the research draft. If the draft gives no page number, cite the document name alone - never fall back to an internal chunk or excerpt index, and never invent a page the draft did not provide.
- The "never mention internal steps" identity rule does NOT apply to source citations: document names and page labels are the student's own uploaded material and must always be shown.
- If the summary says "[General knowledge]", keep that label so the student knows.
- Write as if you are talking directly to ${p.name || "the student"} - warm, clear, encouraging.
- Use clean, organized Markdown: headings, short paragraphs, numbered steps, hyphen bullets, and tables where helpful.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, comparison, or how parts connect - include ONE small diagram as a fenced \`\`\`mermaid code block. Keep it simple and valid: prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; use short plain node labels; no colours, CSS, or style directives. Put it where it clarifies, then keep explaining in words. If the topic is not visual, do not force a diagram.
- Mermaid label syntax is strict: if a node label contains anything other than letters, numbers, and spaces - parentheses, brackets, colons, slashes, commas, quotes - wrap the whole label in double quotes, e.g. A["Adrenaline (1:1000 IM)"] not A[Adrenaline (1:1000 IM)]. An unquoted label with punctuation is a syntax error and the diagram will not render.
- Never output asterisk characters. Do not use asterisks for emphasis, bullets, multiplication, footnotes, or decoration. Use plain labels, hyphen bullets, and the x symbol for multiplication.
- For maths, write equations clearly using plain text or fenced code/math blocks, define every variable, then explain the steps in order.
- If the research summary says it is uncertain about something, reflect that uncertainty honestly.
- CONVERSE. Answer the question they actually asked, in a calm and friendly voice, with the teaching underneath it rather than on top of it. React to what they said before diving in. A reference manual is not the target.${
    hasDocs
      ? ""
      : `
NO FILES ARE IN PLAY FOR THIS ANSWER:
- The student attached none of their own material, so answer directly and well from what you know. Do NOT say the answer could not be found in their files, do NOT ask them to upload something before helping, and do NOT produce a "Source:" line - there is no document to cite.
- At most ONCE in a conversation, and only after the answer is complete, you may close with one short friendly line noting that G&D is built to read their own textbooks, notes and past papers and answer with the page. Skip it entirely if an earlier reply already said it, or if the moment does not suit it. It is a footnote, never the point.`
  }`;
}

/**
 * The whole answer, in one streamed call, for a question with no files.
 *
 * WHY THIS EXISTS. The no-documents route used to run callDeepSeekSync() - a
 * BLOCKING, non-streamed research draft with a 75 second ceiling - and only then
 * start streaming the styled answer. Measured against production, "what is a
 * nephron" put the first character on screen after SIXTY-FOUR SECONDS. Students
 * reported the chat as frozen, and they were right to: a minute of blank screen
 * is indistinguishable from a broken app.
 *
 * The second hop existed to let a reasoning model do the facts and a styling
 * model do the voice. With no documents to search there is no retrieval for the
 * first hop to do - it was answering from its own knowledge and handing that to
 * another model to rewrite. One capable model does both, and the student sees
 * words immediately.
 *
 * The LIBRARY route keeps both hops. There the first one really does work: it
 * reads the excerpts and pins the citations, which is the part that must not be
 * guessed at.
 *
 * This is the rewriter's prompt with the draft removed and the source rules
 * dropped, since there is nothing to cite.
 */
function buildDirectAnswerSystemPrompt(
  p: Profile,
  mode: Mode,
  usingWebCurriculum: boolean,
): string {
  return `You are G&D, a study companion for students.

IDENTITY (strict): You are G&D, and only G&D. Never mention, name, or hint at any
underlying model, provider, or internal step - including "DeepSeek", "GPT",
"OpenAI", "the draft", "the research engine", or "as an AI language model". If
the student asks what you are or what powers you, say you are G&D.

${buildStudentIdentity(p, { usingWebCurriculum })}

STYLE INSTRUCTIONS:
${modeInstruction(mode, p.exam_format || "MCQ")}

RULES:
- Answer the question directly and accurately from what you know. Lead with the answer, then the reasoning.
- CONVERSE. React to what they actually asked, in a calm and friendly voice, with the teaching underneath it rather than on top of it. A reference manual is not the target.
- No files are attached to this question, so there is nothing to cite. Do NOT produce a "Source:" line, do NOT say the answer was missing from their files, and do NOT ask them to upload anything before helping.
- Be honest about uncertainty. If something is genuinely disputed or you are unsure, say so rather than inventing a confident answer.
- Never invent citations, page numbers, statistics or study references.
- Write as if you are talking directly to ${p.name || "the student"} - warm, clear, encouraging.
- Use clean, organized Markdown: headings, short paragraphs, numbered steps, hyphen bullets, and tables where helpful.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, comparison, or how parts connect - include ONE small diagram as a fenced \`\`\`mermaid code block. Keep it simple and valid: prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; use short plain node labels; no colours, CSS, or style directives. If the topic is not visual, do not force a diagram.
- Mermaid label syntax is strict: if a node label contains anything other than letters, numbers, and spaces - parentheses, brackets, colons, slashes, commas, quotes - wrap the whole label in double quotes, e.g. A["Adrenaline (1:1000 IM)"] not A[Adrenaline (1:1000 IM)]. An unquoted label with punctuation is a syntax error and the diagram will not render.
- Never output asterisk characters. Do not use asterisks for emphasis, bullets, multiplication, footnotes, or decoration. Use plain labels, hyphen bullets, and the x symbol for multiplication.
- For maths, write equations clearly using plain text or fenced code/math blocks, define every variable, then explain the steps in order.
- At most ONCE in a conversation, and only after the answer is complete, you may close with one short friendly line noting that G&D is built to read their own textbooks, notes and past papers and answer with the page. Skip it if an earlier reply already said it, or if the moment does not suit it. It is a footnote, never the point.`;
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

/**
 * Streaming research engine, used when Detailed+ writes its own final answer.
 * DeepSeek's API is OpenAI-compatible, so the SSE frames carry the same
 * `choices[0].delta.content` shape the client already parses and the same
 * [DONE] marker - the existing stream plumbing needs no special case.
 */
function callDeepSeekStream(
  apiKey: string,
  systemPrompt: string,
  messages: ChatBody["messages"],
  timeoutMs: number,
): Promise<Response> {
  return fetchWithTimeout(
    "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-pro",
        stream: true,
        max_tokens: 8192,
        // Higher than the research draft's 0.2: this text is read by the
        // student, so it needs some life, but notes stay structural.
        temperature: 0.4,
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    timeoutMs,
  );
}

/**
 * `reasoning_effort` is NOT uniform across the GPT-5 family, and the mismatch is
 * a hard 400 rather than a silently ignored field:
 *
 *   gpt-5-nano      accepts "minimal"
 *   gpt-5.6-luna    rejects it - "does not support 'minimal' with this model.
 *                   Supported values are: 'none', 'low', 'medium', 'high', 'xhigh'"
 *
 * That is why Detailed (the only mode on the deep tier that streams through
 * callGPTStream) failed with "OpenAI final explanation failed" while Simplified
 * and Storytelling were fine. Both of these stages only restyle a research draft
 * that DeepSeek has already reasoned out, so we ask each model for the least
 * deliberation it will actually accept.
 */
function reasoningEffortFor(model: string): string {
  return model === OPENAI_MODEL_FAST ? "minimal" : "none";
}

/**
 * The streamed answer the student actually watches appear.
 *
 * No `temperature`: the GPT-5 family rejects it (400) rather than ignoring it.
 * Low reasoning keeps first-token latency close to the old 4o behaviour - this
 * stage is rewriting a finished research draft into the chosen style, so paying
 * for deliberation here would be latency and billed reasoning tokens spent on
 * nothing.
 */
async function callGPTStream(
  apiKey: string,
  model: string,
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
        model,
        stream: true,
        reasoning_effort: reasoningEffortFor(model),
        messages: [{ role: "system", content: systemPrompt }, ...messages],
      }),
    },
    GPT_REWRITE_START_TIMEOUT_MS,
  );
}

async function callOpenAISync({
  apiKey,
  model = OPENAI_MODEL_FAST,
  systemPrompt,
  messages,
  maxTokens = 4096,
  timeoutMs = GPT_VISUAL_SCRIPT_TIMEOUT_MS,
}: {
  apiKey: string;
  model?: string;
  systemPrompt: string;
  messages: ChatBody["messages"];
  maxTokens?: number;
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
        model,
        stream: false,
        // GPT-5 renamed this; `max_tokens` is rejected outright.
        max_completion_tokens: maxTokens,
        reasoning_effort: reasoningEffortFor(model),
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

/**
 * One web-searched call, via the Responses API.
 *
 * The old `gpt-4o-mini-search-preview` model this used to hit was shut down on
 * 23 July 2026 along with every other search-preview snapshot. Web search is now
 * a tool you attach to a normal model rather than a model of its own, which
 * means the Responses endpoint (`/v1/responses`) instead of chat completions,
 * and a different response shape: an `output` array whose `message` item holds
 * `output_text` parts, each carrying its own `url_citation` annotations.
 *
 * Reasoning effort is deliberately left at the default - web search is not
 * supported with minimal reasoning.
 */
async function callOpenAIWebSearch(
  apiKey: string,
  model: string,
  instructions: string,
  input: { role: "user" | "assistant"; content: string }[],
  timeoutMs: number,
  label: string,
): Promise<{ text: string; annotations: WebAnnotation[]; incomplete: boolean }> {
  const resp = await fetchWithTimeout(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        tools: [{ type: "web_search" }],
        instructions,
        input,
      }),
    },
    timeoutMs,
  );

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI ${label} error ${resp.status}: ${text}`);
  }

  const json = await resp.json();
  const output = Array.isArray(json.output) ? json.output : [];
  const parts: string[] = [];
  const annotations: WebAnnotation[] = [];

  for (const item of output) {
    if (item?.type !== "message") continue;
    for (const part of Array.isArray(item.content) ? item.content : []) {
      if (part?.type !== "output_text") continue;
      if (typeof part.text === "string") parts.push(part.text);
      if (Array.isArray(part.annotations)) annotations.push(...part.annotations);
    }
  }

  // `output_text` is the SDK's convenience field; fall back to it in case the
  // walk above finds nothing (e.g. a shape change in a future model).
  const text = parts.length > 0 ? parts.join("") : (json.output_text ?? "");

  return { text, annotations, incomplete: json.status === "incomplete" };
}

async function callOpenAIWebCurriculumSync(
  apiKey: string,
  p: Profile,
  studentQuestion: string,
): Promise<{ text: string; sources: WebSource[] }> {
  const { text, annotations } = await callOpenAIWebSearch(
    apiKey,
    // Pure research feeding another prompt - the cheap tier is enough.
    OPENAI_MODEL_FAST,
    `Search the web for current public course outline or syllabus guidance relevant to this student.
Return a concise, source-grounded study structure:
1. likely curriculum topics,
2. key learning outcomes,
3. exam-heavy points,
4. a sensible order to study.
Keep it short enough to paste into another answer prompt.`,
    [
      {
        role: "user",
        content: `Student context:
- University: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}
- Question/topic: ${studentQuestion}`,
      },
    ],
    WEB_CURRICULUM_TIMEOUT_MS,
    "web curriculum search",
  );

  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: cleanWebAnswerText(text, annotations),
    sources,
  };
}

async function callOpenAIWebAnswerSync(
  apiKey: string,
  p: Profile,
  mode: Mode,
  messages: ChatBody["messages"],
): Promise<{ text: string; sources: WebSource[] }> {
  const { text, annotations, incomplete } = await callOpenAIWebSearch(
    apiKey,
    // This one IS the student's answer, so it follows the same tiering as the
    // non-search path.
    answerModel(mode),
    `You are G&D, a warm precision-answer app using web search because the student requested it.

IDENTITY (strict): You are G&D, and only G&D. Never mention or hint at any underlying model, provider, or internal step - including "DeepSeek", "GPT", "OpenAI", or "as an AI language model". If asked what you are, say you are G&D.

${buildStudentIdentity(p)}

${modeInstruction(mode, p.exam_format || "MCQ")}

RULES:
- Use current web results only when they are relevant to the question.
- Do not list raw URLs in the answer body; the app will show clickable source icons separately.
- If web results are weak or unrelated, say that plainly and answer from general knowledge.
- Use clean, organized Markdown with headings, numbered steps, hyphen bullets, and tables where useful.
- When the concept is naturally visual - a process, cycle, hierarchy, timeline, or comparison - include ONE small diagram as a fenced \`\`\`mermaid code block (prefer "flowchart LR", "flowchart TD", "mindmap", or "sequenceDiagram"; short plain labels; no style directives). Do not force a diagram when the topic is not visual.
- Mermaid label syntax is strict: any node label containing punctuation (parentheses, brackets, colons, slashes, commas) must be wrapped in double quotes, e.g. A["Stage 2 (deep sleep)"]. Unquoted punctuation is a syntax error and the diagram will not render.
- Never output asterisk characters. Use the x symbol for multiplication and plain labels instead of bold syntax.`,
    messages,
    WEB_ANSWER_TIMEOUT_MS,
    "web search",
  );

  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: withLengthLimitNote(
      cleanWebAnswerText(text, annotations),
      incomplete ? "length" : undefined,
    ),
    sources,
  };
}

async function callOpenAIWebVisualResearchSync(
  apiKey: string,
  p: Profile,
  studentQuestion: string,
): Promise<{ text: string; sources: WebSource[] }> {
  const { text, annotations, incomplete } = await callOpenAIWebSearch(
    apiKey,
    OPENAI_MODEL_FAST,
    `Search the web only for facts needed to create an accurate educational animation.

Return a compact research brief:
1. verified core facts,
2. sequence/process steps,
3. visual objects or entities that should appear,
4. short labels suitable for an animation,
5. caveats or uncertainty.

Do not write animation code. Do not list raw URLs in the body; source metadata is handled separately.`,
    [
      {
        role: "user",
        content: `Student context:
- School: ${p.university || "Unknown"}
- Level: ${p.year || "Unknown"}
- Assessment format: ${p.exam_format || "MCQ"}

Visual request: ${studentQuestion}`,
      },
    ],
    WEB_VISUAL_RESEARCH_TIMEOUT_MS,
    "visual web search",
  );

  const sources = await attachSourceImages(webSourcesFromAnnotations(annotations));

  return {
    text: withLengthLimitNote(
      cleanWebAnswerText(text, annotations),
      incomplete ? "length" : undefined,
    ),
    sources,
  };
}

function sourceMetadataSse(sources: WebSource[]): string {
  return sources.length > 0 ? `data: ${JSON.stringify({ medai_sources: sources })}\n\n` : "";
}

// A finished answer, cut into delta frames so it arrives in the same shape a
// streamed one does.
//
// THERE IS NO SLEEP HERE ANY MORE, AND ONE MUST NOT BE ADDED BACK. This helper
// (and textToSse, the ReadableStream twin that used to sit above it and is now
// gone with the last caller that needed it) used to `await setTimeout(12ms)`
// between every 24-character chunk to fake a typing effect. That is
// 12ms x (length / 24): about 1.8 SECONDS of pure invented delay on a
// web-search answer, up to ten on a Visuals one, added AFTER the model had
// finished and AFTER the student had already waited for it. It bought nothing
// visually either - the chat page runs its own reveal loop (`startReveal`,
// also 12ms) over whatever has arrived, so the typing feel is the client's and
// always was. The server's job is to hand the text over as fast as the socket
// will take it.
function enqueueTextAsSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  text: string,
) {
  const chunks = text.match(/.{1,24}(?:\s+|$)/gs) ?? [text];

  for (const content of chunks) {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`),
    );
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
          enqueueTextAsSse(controller, encoder, result.text);
        } catch (err) {
          console.error("visuals pipeline failed:", err);
          enqueueTextAsSse(controller, encoder, fallbackVisualAnimationText());
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

/**
 * Puts already-built SSE text (progress frames) in front of a provider stream.
 *
 * For every route whose upstream is ALREADY a live stream, this is all the
 * narration needs: the provider's response headers land long before its first
 * token - the gap is the model's prefill, which is most of the wait - so frames
 * queued here are flushed into that gap rather than batched with the answer.
 *
 * It is deliberately the dumb option. It cannot narrate work that happens
 * BEFORE the upstream exists (a blocking research draft, a web search); that
 * needs progressStreamResponse below, which commits the 200 first and therefore
 * gives up the ability to answer with a JSON error. Nothing here gives that up,
 * so every route that can use this one does.
 */
function streamWithPrefix(
  upstream: ReadableStream<Uint8Array> | null,
  prefix: string,
): ReadableStream<Uint8Array> | null {
  if (!upstream || !prefix) return upstream;

  const reader = upstream.getReader();
  const encoder = new TextEncoder();
  let sentPrefix = false;

  return new ReadableStream({
    async pull(controller) {
      if (!sentPrefix) {
        sentPrefix = true;
        // Enqueue and RETURN, so the frames go out on their own rather than
        // waiting on the first upstream read.
        controller.enqueue(encoder.encode(prefix));
        return;
      }

      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      return reader.cancel();
    },
  });
}

// Enough sub-rows to show the student it really is their material, few enough
// that the rail stays glanceable. The parent row carries the true count, so the
// cap hides nothing.
const MAX_PROGRESS_DETAILS = 8;

/**
 * The "reading" step, told from the documents the request actually carried.
 *
 * Retrieval itself happens in the client (it owns the embeddings query), so by
 * the time a request lands here the reading is a known quantity - which is
 * exactly why these frames can be honest about it: real file names, and a real
 * count of the labelled passages inside the excerpts.
 *
 * "passages", not "chunks": a chunk is an artefact of how we split a file and
 * means nothing to a student, the same reason docsFromChunkRows() in
 * src/routes/-app.chat-page.tsx refuses to print "Chunk 7" next to a citation.
 *
 * EMPTY IS NOT DONE. Files whose excerpts are all blank are a live problem in
 * this app (uploads that extracted to ~0 chunks), and reporting that as "done"
 * would tell a student we read material we never had. The component has a
 * status for exactly this.
 */
function readingProgressFrames(docs: DocumentCtx[]): AnswerProgressEvent[] {
  const label = docs.length > 1 ? `Reading ${docs.length} of your files` : "Reading your material";
  const frames: AnswerProgressEvent[] = [
    {
      type: "step",
      id: "reading",
      label,
      icon: "reading",
      status: "active",
      detailLabel: "Read",
      detailIcon: "file",
    },
  ];

  for (const doc of docs.slice(0, MAX_PROGRESS_DETAILS)) {
    frames.push({ type: "step_detail", stepId: "reading", text: doc.file_name });
  }

  // Every excerpt passage the client labelled, in either of the two formats it
  // produces: "[Page 47 | Book page 23]" from chunk rows, "[Relevant excerpt 2
  // from ...]" from the whole-text fallback.
  let passages = 0;
  let chars = 0;
  for (const doc of docs) {
    const excerpt = doc.excerpt ?? "";
    chars += excerpt.trim().length;
    passages += excerpt.match(/\[(?:Page\b|Relevant excerpt\b)/g)?.length ?? 0;
  }

  frames.push({
    type: "step",
    id: "reading",
    status: chars > 0 ? "done" : "empty",
    note:
      chars === 0
        ? "no readable text in these files"
        : passages > 0
          ? `${passages} passage${passages === 1 ? "" : "s"}`
          : undefined,
  });

  return frames;
}

/**
 * How the two-hop research draft went, read off the draft itself.
 *
 * Both signals here are the draft's own words, not a guess about them. The
 * "could not find an exact hit in your files" phrasing is dictated verbatim by
 * buildDeepSeekSystemPrompt's step 6, so matching it is reading the engine's
 * own verdict - and that verdict is `empty`, never `done`: a search that found
 * nothing is the one outcome this timeline must not dress up as a success.
 */
function researchDraftFrame(draft: string): AnswerProgressEvent {
  if (/could not find an exact hit/i.test(draft)) {
    return {
      type: "step",
      id: "sources",
      status: "empty",
      note: "nothing matched in your files",
    };
  }

  const pages = new Set((draft.match(/\bPage\s+\d+/gi) ?? []).map((page) => page.toLowerCase()));
  return {
    type: "step",
    id: "sources",
    status: "done",
    note: pages.size > 0 ? `${pages.size} page${pages.size === 1 ? "" : "s"} cited` : undefined,
  };
}

const WRITING_FRAME: AnswerProgressEvent = {
  type: "step",
  id: "writing",
  label: "Writing your answer",
  icon: "writing",
  status: "active",
};

/**
 * A response that starts NOW and narrates the slow work behind it.
 *
 * The two-hop document route and the web-search route both spend 8-25 seconds
 * inside a blocking provider call before they have anything to return, and the
 * student's screen shows nothing at all for it. The only way to say what is
 * happening during that window is to commit the 200 first and write into the
 * open stream as the work lands.
 *
 * WHAT THAT COSTS, AND HOW IT IS PAID BACK. Once the headers are out we can no
 * longer answer with a JSON error, which is how this function has always
 * reported a provider failure (`{ error }` + a 4xx/5xx, turned into a toast by
 * both clients). So a failure after that point is emitted as a `medai_error`
 * frame and the stream is closed WITHOUT a [DONE] marker:
 *   - a client that knows the frame (src/lib/chat-client.ts) reports the exact
 *     message through onError, which is what the toast did before;
 *   - a client that does not (the shipped mobile app) sees a stream that ended
 *     with no content and no [DONE], which both clients already treat as
 *     "ended before any answer arrived - please retry".
 * Neither one saves a bogus answer, and `onFailure` below runs the same cookie
 * refund the outer catch would have run. What is genuinely lost is the HTTP
 * status code and the provider's own words, which only ever reached the logs
 * in any useful form.
 */
function progressStreamResponse({
  headers,
  prelude,
  failureMessage,
  onFailure,
  run,
}: {
  headers: Record<string, string>;
  /** Frames flushed before any work starts - t=0 narration. */
  prelude: AnswerProgressEvent[];
  /** Student-facing copy for a failure with no more specific message. */
  failureMessage: string;
  /** Runs when the work threw, before the error frame goes out (cookie refund). */
  onFailure?: () => Promise<void>;
  run: (emit: (...events: AnswerProgressEvent[]) => void) => Promise<{
    /** An upstream provider stream to pipe through, already SSE-shaped. */
    stream?: ReadableStream<Uint8Array> | null;
    /** ...or a finished answer to frame up ourselves. */
    text?: string;
    sources?: WebSource[];
  }>;
}): Response {
  const encoder = new TextEncoder();
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // The step the failure branch should blame. Tracked rather than assumed,
      // so "the research draft timed out" fails the research row and not the
      // writing row that never started.
      let lastActive: string | null = null;

      const push = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The student navigated away mid-answer. Narration is never worth an
          // exception on a stream nobody is reading.
        }
      };
      const close = () => {
        try {
          controller.close();
        } catch {
          /* already closed or cancelled */
        }
      };

      const emit = (...events: AnswerProgressEvent[]) => {
        if (events.length === 0) return;
        for (const event of events) {
          if (event.type !== "step") continue;
          // `status` omitted means "active" in the client's reducer.
          const status = event.status ?? "active";
          if (status === "active") lastActive = event.id;
          else if (lastActive === event.id) lastActive = null;
        }
        push(progressSse(...events));
      };

      emit(...prelude);

      (async () => {
        try {
          const result = await run(emit);
          const sources = result.sources ?? [];

          if (result.stream) {
            // streamWithSources injects the source frame ahead of the
            // provider's own [DONE], exactly as it does on the direct routes.
            const merged = streamWithSources(result.stream, sources) ?? result.stream;
            const reader = merged.getReader();
            upstreamReader = reader;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
            close();
            return;
          }

          enqueueTextAsSse(controller, encoder, result.text ?? "");
          if (sources.length > 0) push(sourceMetadataSse(sources));
          push("data: [DONE]\n\n");
          close();
        } catch (err) {
          console.error("progress stream failed:", err);
          if (onFailure) await onFailure().catch(() => {});
          const message = err instanceof StudentFacingError ? err.message : failureMessage;
          emit({
            type: "step",
            id: lastActive ?? "writing",
            // Only names the row when we are creating it; an existing row keeps
            // the label it was given.
            label: lastActive ? undefined : "Writing your answer",
            status: "failed",
            error: message,
          });
          // No [DONE]: see the header note. Its absence is what an older client
          // reads as "the stream ended before any answer arrived", which is
          // exactly what happened.
          push(`data: ${JSON.stringify({ medai_error: message })}\n\n`);
          close();
        }
      })();
    },
    cancel() {
      return upstreamReader?.cancel();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", ...headers },
  });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * What the student is told when the styling hop refuses.
 *
 * Extracted so the two callers cannot drift: openAIRewriteResponse still
 * answers with these words AND the upstream status code, while the narrated
 * two-hop route can only send the words - by the time it knows, it has already
 * committed a 200 (see progressStreamResponse). The strings themselves are
 * unchanged; one of them tells the owner which Supabase secret to fix.
 */
function gptRewriteErrorMessage(status: number): string {
  return status === 429
    ? "OpenAI final explanation is rate limited. Please wait a few seconds and try again."
    : status === 401
      ? "OpenAI API key rejected. Please check your Supabase Edge Function secrets."
      : "OpenAI final explanation failed";
}

async function openAIRewriteResponse({
  apiKey,
  systemPrompt,
  messages,
  mode,
  model,
  source,
  sources,
  progress = [],
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatBody["messages"];
  // Picks the OpenAI tier. Distinct from `model` below, which is the pipeline
  // label reported back in the X-Medai-Model header.
  mode: Mode;
  model: string;
  source: string;
  sources: WebSource[];
  // Timeline frames flushed ahead of the answer. Free here: the JSON-error
  // branch below still runs first, so this adds narration without giving up
  // the error status the way progressStreamResponse has to.
  progress?: AnswerProgressEvent[];
}): Promise<Response> {
  const gptResp = await callGPTStream(apiKey, answerModel(mode), systemPrompt, messages);

  if (!gptResp.ok) {
    const text = await gptResp.text();
    console.error("OpenAI rewrite error:", gptResp.status, text);
    // Unchanged: this caller has not sent a byte yet, so it still answers with
    // the real upstream status the clients turn into a toast.
    const msg = gptRewriteErrorMessage(gptResp.status);
    return new Response(JSON.stringify({ error: msg }), {
      status: gptResp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    streamWithPrefix(streamWithSources(gptResp.body, sources), progressSse(...progress)),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Medai-Model": model,
        "X-Medai-Source": source,
      },
    },
  );
}

/** Detailed+ notes streamed straight from the research engine, no styling pass. */
async function deepSeekNotesResponse({
  apiKey,
  systemPrompt,
  messages,
  model,
  source,
  sources,
  timeoutMs,
  progress = [],
}: {
  apiKey: string;
  systemPrompt: string;
  messages: ChatBody["messages"];
  model: string;
  source: string;
  sources: WebSource[];
  timeoutMs: number;
  /** Timeline frames flushed ahead of the answer - see openAIRewriteResponse. */
  progress?: AnswerProgressEvent[];
}): Promise<Response> {
  const resp = await callDeepSeekStream(apiKey, systemPrompt, messages, timeoutMs);

  if (!resp.ok) {
    const text = await resp.text();
    console.error("DeepSeek notes error:", resp.status, text);
    // User-facing copy never names the provider - see the identity rule.
    const msg =
      resp.status === 429
        ? "G&D is rate limited right now. Please wait a few seconds and try again."
        : resp.status === 401
          ? "G&D's study engine rejected its key. Please check the Edge Function secrets."
          : "G&D could not finish these notes. Please try again.";
    return new Response(JSON.stringify({ error: msg }), {
      status: resp.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    streamWithPrefix(streamWithSources(resp.body, sources), progressSse(...progress)),
    {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "X-Medai-Model": model,
        "X-Medai-Source": source,
      },
    },
  );
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

// ── Cookies: the daily AI budget ────────────────────────────────────────────
//
// A chat message costs 1 cookie - see COOKIE_COSTS.chat in src/lib/cookies.ts,
// the one place this price is meant to live. This is a deliberate second copy
// of that single number, not a fork of the pricing logic: Edge Functions
// deploy separately from the frontend and cannot import src/lib/cookies.ts
// (it is browser code - it imports the browser Supabase client and reads
// import.meta.env). If the two numbers are ever found to disagree, this one is
// the one actually being billed, so src/lib/cookies.ts is the one to fix.
//
// FAILS OPEN, WITHOUT EXCEPTION. supabase/migrations/20260824130000_cookies_
// daily_budget.sql is applied BY HAND, separately from this function's own
// deploy, so there will be a real window where this code runs against a
// database that does not have spend_cookies_for() yet. The only outcome
// allowed to refuse a student is that function answering ok:false in so many
// words - see the migration's own header. Everything else (the function
// missing, a thrown error, a caller with no resolvable user id - e.g. a guest
// on the publishable/anon key, which carries no `sub` claim to charge against)
// falls through to `{ status: "skipped" }`, which every caller below treats
// exactly like "charged for free": the request proceeds.
//
// WHY A SERVICE-ROLE CLIENT FOR THE CHARGE BUT NOT THE REFUND. spend_cookies_
// for() is deliberately REVOKED from `authenticated` in the migration - only
// the service role may call it, naming the user explicitly as p_user, which is
// what makes it trustworthy to charge someone OTHER than "whoever's JWT this
// is". refund_cookie_spend() is the opposite shape: it takes no user
// parameter and checks `user_id = auth.uid()` internally, which means it must
// be called AS the student, not as the service role (a service-role JWT has
// no `sub` claim, so auth.uid() would be NULL and the ownership check would
// never match). So the refund client below is built with the service-role key
// for gateway auth but the STUDENT'S OWN forwarded Authorization header for
// the RLS-visible identity - a standard Supabase pattern for "call this one
// RPC as the caller, using a privileged key to reach it."
function decodeUserId(authHeader: string | null): string | null {
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const token = authHeader.slice("Bearer ".length);
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))) as {
      sub?: unknown;
    };
    return typeof payload.sub === "string" && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

type CookieCharge =
  | { status: "charged"; spendId: number | null }
  | { status: "refused"; remaining: number; allowance: number }
  | { status: "skipped" };

async function chargeCookies(
  authHeaderRaw: string | null,
  action: string,
  cost: number,
): Promise<CookieCharge> {
  if (cost <= 0) return { status: "skipped" };
  const userId = decodeUserId(authHeaderRaw);
  if (!userId) return { status: "skipped" };

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) return { status: "skipped" };

  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.rpc("spend_cookies_for", {
      p_user: userId,
      p_action: action,
      p_cost: cost,
    });
    if (error) return { status: "skipped" }; // missing function, RPC error, etc. - fail open
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return { status: "skipped" };
    if (row.ok === false) {
      return { status: "refused", remaining: row.remaining ?? 0, allowance: row.allowance ?? 0 };
    }
    return { status: "charged", spendId: row.spend_id ?? null };
  } catch {
    return { status: "skipped" };
  }
}

async function refundCookies(authHeaderRaw: string, spendId: number | null): Promise<void> {
  if (spendId == null) return;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_ROLE) return;
  try {
    const asStudent = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authHeaderRaw } },
    });
    await asStudent.rpc("refund_cookie_spend", { p_spend_id: spendId });
  } catch {
    // Best effort. A missed refund costs the student one cookie on a
    // generation that already failed them once - unfortunate, never blocking.
  }
}

const CHAT_COOKIE_COST = 1;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declared outside the try so the catch block below can still see them -
  // variables scoped inside `try { }` are not visible from its own `catch`.
  const authHeaderRaw = req.headers.get("Authorization");
  let cookieCharge: CookieCharge | null = null;

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

    // Charge before any AI provider is called, and after the config checks
    // above - a misconfigured server should not cost a student a cookie for a
    // request that was never going anywhere. One charge per message,
    // regardless of which route (small talk / web / library / direct) it
    // ends up taking below.
    cookieCharge = await chargeCookies(authHeaderRaw, "chat", CHAT_COOKIE_COST);
    if (cookieCharge.status === "refused") {
      return new Response(
        JSON.stringify({
          error: "out_of_cookies",
          remaining: cookieCharge.remaining,
          allowance: cookieCharge.allowance,
        }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let curriculumGuidance = "";
    let webSources: WebSource[] = [];
    // Timeline rows for work that finished BEFORE the answer stream opened.
    // They go out with the stream's first flush rather than live, which is the
    // honest thing available here: this hop runs before any route has committed
    // to a response, and wrapping the whole handler in a stream to narrate a
    // step that only fires on bare-topic questions would trade the JSON error
    // path away on every route to buy narration on one.
    const preludeFrames: AnswerProgressEvent[] = [];

    if (useWebCurriculum) {
      try {
        const webResult = await callOpenAIWebCurriculumSync(
          OPENAI_API_KEY,
          body.profile,
          lastUserMessage.content,
        );
        curriculumGuidance = webResult.text;
        webSources = webResult.sources;
        preludeFrames.push({
          type: "step",
          id: "web",
          label: "Checked course outlines online",
          icon: "web",
          // No sources back means the search genuinely found nothing to stand
          // on, even though it returned prose. That is `empty`, not `done`.
          status: webSources.length > 0 ? "done" : "empty",
          note: webSources.length > 0 ? `${webSources.length} sources` : "nothing usable found",
        });
        for (const webSource of webSources.slice(0, MAX_PROGRESS_DETAILS)) {
          preludeFrames.push({
            type: "step_detail",
            stepId: "web",
            text: webSource.title,
            label: "Read",
            icon: "web",
          });
        }
      } catch (err) {
        console.error("OpenAI web curriculum search failed:", err);
        curriculumGuidance =
          "Web course outline search was requested but unavailable. Use broad course-level priorities, organise the answer by likely learning outcomes, and tell the student this fallback is not their official school syllabus.";
        preludeFrames.push({
          type: "step",
          id: "web",
          label: "Checked course outlines online",
          icon: "web",
          status: "failed",
          error: "Course outline search was unavailable, so this answer is not syllabus-specific",
        });
      }
    }

    // ── Small talk: one call, straight to the student ──────────────────────
    //
    // Everything below this point is the study pipeline: retrieval, a research
    // engine, then a styling pass. A greeting needs none of it, and paying for
    // all of it is what made the app feel slow on the most ordinary message
    // there is. Visuals is excluded because its whole output IS the pipeline.
    if (
      !candidateHasDocs &&
      !body.forceWebSearch &&
      body.mode !== "Visuals" &&
      isSmallTalk(lastUserMessage?.content ?? "")
    ) {
      const fastResp = await callGPTStream(
        OPENAI_API_KEY,
        OPENAI_MODEL_FAST,
        buildConversationalSystemPrompt(body.profile),
        body.messages,
      );
      if (fastResp.ok) {
        return new Response(streamWithSources(fastResp.body, []), {
          headers: {
            ...corsHeaders,
            "Content-Type": "text/event-stream",
            "X-Medai-Model": "gpt-conversational",
            "X-Medai-Source": "general",
          },
        });
      }
      // Fall through to the full pipeline rather than failing: a student who
      // said hello should never see an error screen for it.
      console.error("conversational fast path failed:", fastResp.status);
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
      // The search itself is the wait - one blocking Responses call that can run
      // most of a minute - and it used to be spent behind a completely silent
      // socket. The shell opens the stream first so the student can at least see
      // that a search is running and, as they land, which pages it found.
      //
      // The failure path is UNCHANGED and stays inside run(): a web answer that
      // times out has always come back as a friendly 200, never an error, so
      // there is nothing here for the shell's error branch to do. The one thing
      // that could not survive the move is the "web-search-timeout" value in the
      // X-Medai-Model header (headers are committed before the outcome is
      // known); the failed `web` row now carries that signal instead, and the
      // console.error below is untouched.
      return progressStreamResponse({
        headers: { "X-Medai-Model": "gpt-web-search", "X-Medai-Source": "general" },
        prelude: [
          {
            type: "step",
            id: "web",
            label: "Searching the web",
            icon: "web",
            status: "active",
            detailLabel: "Found",
            detailIcon: "web",
          },
        ],
        failureMessage:
          "Web search took too long to finish. Try again in a moment, or turn Web off and I can answer from general knowledge.",
        run: async (emit) => {
          try {
            const webResult = await callOpenAIWebAnswerSync(
              OPENAI_API_KEY,
              body.profile,
              body.mode,
              body.messages,
            );
            for (const webSource of webResult.sources.slice(0, MAX_PROGRESS_DETAILS)) {
              emit({ type: "step_detail", stepId: "web", text: webSource.title });
            }
            // No citable sources back is a real outcome of a search, not a
            // success - the answer that follows is general knowledge.
            emit({
              type: "step",
              id: "web",
              status: webResult.sources.length > 0 ? "done" : "empty",
              note:
                webResult.sources.length > 0
                  ? `${webResult.sources.length} sources`
                  : "no usable sources",
            });
            return { text: webResult.text, sources: webResult.sources };
          } catch (err) {
            console.error("OpenAI web answer failed:", err);
            emit({
              type: "step",
              id: "web",
              status: "failed",
              error: "Web search did not finish in time",
            });
            return {
              text: "Web search took too long to finish. Try again in a moment, or turn Web off and I can answer from general knowledge.",
            };
          }
        },
      });
    }

    if (hasDocs) {
      // Same value the branch used to read as `body.documents!`; `hasDocs` is
      // only true when the array is non-empty.
      const docs = body.documents ?? [];
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

      // The rows that describe work already done by the time this request
      // arrived: any web-curriculum hop, then the student's own files.
      const docProgress = [...preludeFrames, ...readingProgressFrames(docs)];

      // Detailed+ writes its own notes: same research engine, but it streams the
      // finished answer instead of a draft for a second model to restyle.
      if (body.mode === "Detailed+") {
        return deepSeekNotesResponse({
          apiKey: DEEPSEEK_API_KEY!,
          systemPrompt: `${buildDeepSeekSystemPrompt(body.profile, docs, interlink, useWebCurriculum, { finalAnswer: true })}

${buildDeepSeekNotesSystemPrompt(body.profile, body.mode, interlink, useWebCurriculum, docs)}`,
          messages: deepSeekMessages,
          model: "deepseek-notes-library",
          source,
          sources: webSources,
          timeoutMs: DEEPSEEK_DOCUMENT_TIMEOUT_MS,
          progress: [...docProgress, WRITING_FRAME],
        });
      }

      // ── The document route in ONE hop, opt-in ────────────────────────────
      //
      // OFF UNLESS THE REQUEST ASKS FOR IT. Everything below this block is the
      // pipeline exactly as it shipped, and `body.singleHop` absent must leave
      // it that way byte for byte - this function answers the website and the
      // native mobile app from one deployment, with no staging copy to try a
      // rewrite on, so the flag IS the staging environment. Flip it per request
      // (see `singleHop` in src/lib/chat-client.ts) and run the same question
      // both ways against the live function.
      //
      // What it changes: the blocking, non-streamed research draft is gone. The
      // two-hop path below asks DeepSeek for a full 8192-token draft with
      // `stream: false`, waits out the whole thing, and only then starts GPT -
      // 8 to 25 seconds before the first character, on the route that fires for
      // every student who has ever uploaded a file. Here the same engine, given
      // the same retrieval instructions, writes the finished answer itself and
      // streams it. This is not new architecture: it is exactly what Detailed+
      // does directly above, in production, today.
      //
      // The two things the retired GPT hop used to own are handed over
      // explicitly rather than assumed - see SINGLE_HOP_CONTRACT for the length
      // discipline and the citation-versus-length rule.
      if (body.singleHop === true) {
        return deepSeekNotesResponse({
          apiKey: DEEPSEEK_API_KEY!,
          systemPrompt: `${buildDeepSeekSystemPrompt(body.profile, docs, interlink, useWebCurriculum, { finalAnswer: true })}

${buildDeepSeekNotesSystemPrompt(body.profile, body.mode, interlink, useWebCurriculum, docs)}

${SINGLE_HOP_CONTRACT}`,
          messages: [
            ...priorMessages,
            {
              role: "user" as const,
              // The tail is the rewriter's own closing instruction, kept
              // verbatim where it still applies. It is not decoration: mode
              // length limits lived in the GPT turn, and a retrieval engine
              // told to "search thoroughly" will happily write four times the
              // brief unless the final turn says otherwise.
              content: `${deepSeekMessages[deepSeekMessages.length - 1].content}

Now produce the final answer STRICTLY following the ${body.mode} mode rules in your system prompt. Do not exceed the length and structure limits for that mode. The required "Source:" line is exempt from those limits and must still be there.`,
            },
          ],
          model: useWebCurriculum
            ? "deepseek-single-hop-library-web-curriculum"
            : "deepseek-single-hop-library",
          source,
          sources: webSources,
          timeoutMs: DEEPSEEK_DOCUMENT_TIMEOUT_MS,
          progress: [...docProgress, WRITING_FRAME],
        });
      }

      // ── The shipped two-hop path, now narrated ───────────────────────────
      //
      // Unchanged in what it asks the models for: the same research draft, the
      // same rewriter prompt, the same messages, the same header labels. What
      // changed is WHEN the response starts. It used to begin after the draft
      // came back, so the draft - the longest single wait in the app - was
      // invisible, and "the chat is frozen" was a fair description of a screen
      // showing nothing for 25 seconds. Opening the stream first buys the
      // student a live account of it.
      //
      // The cost of opening early is the JSON error response; progressStream
      // Response's header explains the trade and how a failure now reaches the
      // student. `onFailure` keeps the one thing that must not be lost with it:
      // the refund the outer catch used to run. That catch no longer sees these
      // failures, so there is no double refund.
      return progressStreamResponse({
        headers: {
          "X-Medai-Model": useWebCurriculum
            ? "deepseek-to-openai-library-web-curriculum"
            : "deepseek-to-openai-library",
          "X-Medai-Source": source,
        },
        prelude: [
          ...docProgress,
          {
            type: "step",
            id: "sources",
            label: "Pulling the strongest sources",
            icon: "retrieval",
            status: "active",
          },
        ],
        failureMessage: "G&D could not finish this answer. Please try again.",
        onFailure: async () => {
          const charge = cookieCharge;
          if (charge?.status === "charged" && authHeaderRaw) {
            await refundCookies(authHeaderRaw, charge.spendId);
          }
        },
        run: async (emit) => {
          const deepSeekText = await callDeepSeekSync(
            DEEPSEEK_API_KEY!,
            buildDeepSeekSystemPrompt(body.profile, docs, interlink, useWebCurriculum),
            deepSeekMessages,
            DEEPSEEK_DOCUMENT_TIMEOUT_MS,
          );

          emit(researchDraftFrame(deepSeekText));
          emit(WRITING_FRAME);

          // openAIRewriteResponse's body, inlined because the response has
          // already been committed as a 200 - there is no JSON error branch
          // left to reuse. The prompts, the tier, and the failure copy are the
          // same; keep them in step with that function.
          const gptResp = await callGPTStream(
            OPENAI_API_KEY,
            answerModel(body.mode),
            buildGPTRewriterSystemPrompt(
              body.profile,
              body.mode,
              interlink,
              useWebCurriculum,
              true,
            ),
            [
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
          );

          if (!gptResp.ok) {
            const text = await gptResp.text();
            console.error("OpenAI rewrite error:", gptResp.status, text);
            throw new StudentFacingError(gptRewriteErrorMessage(gptResp.status), gptResp.status);
          }

          return { stream: gptResp.body, sources: webSources };
        },
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

      // See the library branch: Detailed+ answers itself.
      if (body.mode === "Detailed+") {
        return deepSeekNotesResponse({
          apiKey: DEEPSEEK_API_KEY!,
          systemPrompt: buildDeepSeekNotesSystemPrompt(
            body.profile,
            body.mode,
            false,
            useWebCurriculum,
            null,
          ),
          messages: deepSeekMessages,
          model: "deepseek-notes",
          source,
          sources: webSources,
          timeoutMs: DEEPSEEK_CHAT_TIMEOUT_MS,
          progress: [...preludeFrames, WRITING_FRAME],
        });
      }

      // ONE hop, streamed. The blocking research draft that used to sit here put
      // the first character of a plain answer on screen after 64 seconds
      // (measured against production), which students reported as the chat
      // freezing. See buildDirectAnswerSystemPrompt for why the second model
      // had nothing to do on this route.
      return openAIRewriteResponse({
        apiKey: OPENAI_API_KEY,
        systemPrompt: buildDirectAnswerSystemPrompt(body.profile, body.mode, useWebCurriculum),
        messages: curriculumGuidance
          ? [
              ...priorMessages,
              {
                role: "user" as const,
                content: `${lastUserMessage.content}

---
WEB CURRICULUM GUIDANCE (use this for what to prioritise; do not mention it):
${curriculumGuidance}
---`,
              },
            ]
          : body.messages,
        mode: body.mode,
        model: useWebCurriculum ? "openai-direct-web-curriculum" : "openai-direct",
        source,
        sources: webSources,
        // One row, because there is honestly only one piece of work here: this
        // route has no retrieval and no research hop, and inventing a "thinking"
        // step to pad the rail would be the client's scripted guess wearing the
        // server's authority. Any web-curriculum row earned its place - that
        // hop really did run, and it is most of the wait when it does.
        progress: [...preludeFrames, WRITING_FRAME],
      });
    }
  } catch (e) {
    console.error("chat error:", e);
    // Charge first, refund on failure - see the header note above
    // chargeCookies(). Every branch that reaches this catch failed outright
    // (threw all the way out), which is exactly the case a refund is for.
    if (cookieCharge?.status === "charged" && authHeaderRaw) {
      await refundCookies(authHeaderRaw, cookieCharge.spendId);
    }
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
