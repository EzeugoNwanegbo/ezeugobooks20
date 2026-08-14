const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Action = "generate_plan" | "generate_questions" | "generate_flashcards" | "review_answers";
type QuestionType = "mcq" | "essay" | "mixed" | "flashcard";

interface Profile {
  name?: string;
  university?: string;
  year?: string;
  exam_format?: string;
  preferred_mode?: string;
  weak_areas?: string[];
  recent_topics?: string[];
}

interface StudyDocument {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
}

interface Body {
  action: Action;
  profile: Profile;
  mode?: "Simplified" | "Detailed" | "Storytelling";
  planTitle?: string;
  courseOutline?: string;
  documents?: StudyDocument[];
  topic?: {
    id?: string;
    title: string;
    summary?: string | null;
    objectives?: unknown;
    source_refs?: unknown;
  };
  questionType?: QuestionType;
  count?: number;
  // For "mixed" practice the caller asks for an explicit split.
  mcqCount?: number;
  essayCount?: number;
  questions?: unknown[];
  answers?: Record<string, string>;
  excludePrompts?: string[];
  difficultyHint?: "easier" | "medium" | "harder";
  // Explicit level chosen by the student in the test setup. When present it
  // overrides the adaptive difficultyHint.
  difficulty?: "easy" | "medium" | "hard";
}

type DifficultyLevel = "easy" | "medium" | "hard";

// Absolute, student-chosen difficulty. "hard" must be genuinely punishing while
// staying 100% answerable from the excerpts - never reaching outside the files.
function difficultyInstruction(level: DifficultyLevel): string {
  if (level === "easy") {
    return `DIFFICULTY: EASY.
- Test direct recall and recognition of facts that are stated plainly in the excerpts.
- One step to answer. Use clear, unambiguous wording.
- For MCQ, make the three distractors clearly wrong to someone who read the material.`;
  }
  if (level === "hard") {
    return `DIFFICULTY: HARD - make these EXTREMELY challenging, exam-topper level.
- Demand multi-step reasoning: require combining and synthesising facts spread across SEVERAL excerpts, not a single sentence.
- Target subtle distinctions, edge cases, exceptions, mechanisms, "why/how" reasoning, and commonly confused points.
- For MCQ, every distractor must be highly plausible and drawn from the excerpts (e.g. a true-but-irrelevant fact, a near-miss, or a common misconception the material corrects). No giveaway options.
- Use precise, demanding wording. The student should have to truly understand the material to answer.
- ABSOLUTE GROUNDING RULE: despite the difficulty, every question, the correct answer, every distractor, and the explanation must remain fully verifiable from the provided excerpts ONLY. Do NOT pull in any fact, term, or scenario that is not in the files. Hard means deeper use of the material, never outside material.`;
  }
  return `DIFFICULTY: MEDIUM.
- Test understanding and application, not just recall: require interpreting or applying a fact from the excerpts.
- Two related ideas may be combined. Distractors should be plausible but resolvable from the material.`;
}

const MAX_DOC_CHARS_TOTAL = 100_000;
const DEEPSEEK_TIMEOUT_MS = 90_000;

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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function stripCodeFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

/**
 * Pull every BALANCED top-level object out of the first array in `text`,
 * keeping the ones that parse and discarding the rest.
 *
 * This exists because one malformed item used to cost the whole batch. The
 * model occasionally emits a question containing a raw newline or an unescaped
 * quote inside a string; that breaks the enclosing array, JSON.parse fails at
 * whatever character the damage starts on, and a request for ten perfectly good
 * questions returns nothing but
 *
 *     expected ',' or ']' after array element in JSON at position 4795
 *
 * which is what the student sees. Nine intact questions are far better than an
 * error, and the caller already tolerates a short batch - generateOneType()
 * loops until it has collected enough, so a salvaged batch simply means one
 * more round rather than a failure.
 *
 * Scanning is string-aware (quotes and backslash escapes) so a brace inside a
 * question's text cannot be mistaken for structure.
 */
function salvageObjects(text: string): Record<string, unknown>[] {
  // Every position where a '{' opens, so that when its matching '}' is found the
  // slice between them can be tried. Objects are collected at ANY depth rather
  // than only inside the first array: the earlier version anchored on the first
  // '[' and tracked depth from there, which recovered nothing whenever the
  // damage was before that point, or the array was nested deeper than assumed,
  // or the model wrapped its output differently than expected. Depth-agnostic
  // scanning has no such assumption to be wrong about.
  const opens: number[] = [];
  const out: Record<string, unknown>[] = [];
  let inString = false;
  let escaped = false;

  // Sub-objects INSIDE an item (an options map, a nested rubric) parse just as
  // happily as the item itself, so shape is what separates a question from its
  // own innards. Anything carrying one of these reads as a whole item.
  const ITEM_KEYS = ["prompt", "question", "front", "term", "title"];
  const looksLikeItem = (o: Record<string, unknown>) =>
    ITEM_KEYS.some((k) => k in o);

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') { inString = true; continue; }
    if (ch === "{") { opens.push(i); continue; }
    if (ch === "}") {
      const start = opens.pop();
      if (start === undefined) continue;
      try {
        const parsed = JSON.parse(text.slice(start, i + 1));
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          // Only whole items, and never one already represented by an outer
          // object that also parsed — collecting both would duplicate content.
          if (looksLikeItem(obj)) out.push(obj);
        }
      } catch {
        // Damaged. Skip it; the items after it are usually intact, because the
        // model recovers its own formatting after a bad string.
      }
      continue;
    }
  }

  return out;
}

function parseJsonObject(text: string): Record<string, unknown> {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        // fall through to salvage
      }
    }

    // Last resort before failing the whole call: rescue the individual items.
    // The key is guessed from the shape the callers expect, which is the only
    // thing this function knows about them - questions, flashcards or topics.
    const salvaged = salvageObjects(cleaned);
    if (salvaged.length) {
      const key = /"flashcards"\s*:/.test(cleaned)
        ? "flashcards"
        : /"topics"\s*:/.test(cleaned)
          ? "topics"
          : "questions";
      console.warn(
        `studybody: recovered ${salvaged.length} ${key} from malformed model JSON`,
      );
      return { [key]: salvaged };
    }

    // Nothing was recoverable. Say what actually arrived rather than only that
    // it was wrong: an empty body, a refusal in prose, and a truncated array are
    // three different faults with three different fixes, and "AI returned
    // invalid JSON" cannot tell them apart - which cost a full debugging round
    // when a student hit it.
    const head = cleaned.slice(0, 180).replace(/\s+/g, " ");
    const tail = cleaned.length > 360 ? cleaned.slice(-120).replace(/\s+/g, " ") : "";
    console.error(
      `studybody: unsalvageable model output (${cleaned.length} chars) head=${JSON.stringify(head)} tail=${JSON.stringify(tail)}`,
    );
    throw new Error(
      cleaned.length === 0
        ? "The AI returned an empty response. Please try again."
        : `AI returned invalid JSON (${cleaned.length} chars, starts: ${head.slice(0, 80)})`,
    );
  }
}

function documentContext(documents: StudyDocument[] = []): string {
  if (!documents.length) return "No uploaded document excerpts were provided.";
  const perDoc = Math.max(2000, Math.floor(MAX_DOC_CHARS_TOTAL / documents.length));
  return documents
    .map(
      (doc) =>
        `=== DOCUMENT: ${doc.file_name}${doc.folder ? ` | folder: ${doc.folder}` : ""} (id:${doc.id}) ===\n${doc.excerpt.slice(0, perDoc)}`,
    )
    .join("\n\n---\n\n");
}

function profileBlock(profile: Profile): string {
  return `Student:
- Name: ${profile.name || "Student"}
- School: ${profile.university || "Unknown"}
- Level: ${profile.year || "Unknown"}
- Assessment format: ${profile.exam_format || "MCQ"}
- Preferred response mode: ${profile.preferred_mode || "Simplified"}
- Weak areas: ${(profile.weak_areas || []).join(", ") || "none recorded"}
- Recent topics: ${(profile.recent_topics || []).slice(0, 8).join(", ") || "none recorded"}`;
}

async function callDeepSeekJson(apiKey: string, systemPrompt: string, userPrompt: string) {
  const response = await fetchWithTimeout(
    "https://api.deepseek.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("DEEPSEEK_MODEL") || "deepseek-v4-pro",
        temperature: 0.2,
        max_tokens: 8192,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    DEEPSEEK_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`DeepSeek error ${response.status}: ${text}`);
  }

  const json = await response.json();
  const choice = json.choices?.[0];
  const content: string = choice?.message?.content ?? "";

  // `?? "{}"` used to stand here, which does NOT catch an empty STRING - only
  // null and undefined - so a 200 response carrying no content fell through to
  // the JSON parser and surfaced as "invalid JSON" with nothing to debug from.
  // An empty completion is a different fault entirely and worth naming.
  if (!content.trim()) {
    const reason = choice?.finish_reason ?? "unknown";
    console.error(
      `studybody: empty completion. finish_reason=${reason} ` +
        `reasoning_content=${Boolean(choice?.message?.reasoning_content)} ` +
        `usage=${JSON.stringify(json.usage ?? {})}`,
    );
    // 'length' means the model used its whole output budget without producing
    // an answer - on a reasoning model the thinking itself is billed against
    // max_tokens, so a long prompt can consume the lot before a single question
    // is written. That is a size problem the student can act on, unlike the
    // others, so it gets its own sentence.
    throw new Error(
      reason === "length"
        ? "The AI ran out of room before it finished writing. Try fewer questions, or a single topic instead of the whole file."
        : `The AI returned an empty response (${reason}). Please try again.`,
    );
  }

  return parseJsonObject(content);
}

function hasUsableDocuments(documents: StudyDocument[] = []): boolean {
  return documents.some((doc) => (doc.excerpt || "").trim().length > 40);
}

async function generatePlan(body: Body, deepSeekKey: string) {
  const result = await callDeepSeekJson(
    deepSeekKey,
    `You are StudyBody's roadmap engine. Read uploaded study material and produce a structured study roadmap.
DeepSeek does the file-reading and planning work. Return strict JSON only.`,
    `${profileBlock(body.profile)}

Plan title requested: ${body.planTitle || "Untitled study plan"}
Course outline supplied by user:
"""
${body.courseOutline || "No formal outline supplied. Create a sensible roadmap from the uploaded file excerpts."}
"""

Uploaded file excerpts:
${documentContext(body.documents)}

Return JSON with this shape:
{
  "title": "short roadmap title",
  "course_outline": "clean outline used",
  "source_type": "uploaded" | "generated" | "mixed",
  "topics": [
    {
      "title": "topic name",
      "summary": "what the student must master",
      "objectives": ["objective 1", "objective 2"],
      "source_refs": [{"file":"name", "page":"Page N, or omit if the excerpt has no page", "note":"why this source matters"}],
      "estimated_minutes": 25
    }
  ]
}
Use 5 to 10 roadmap topics. Keep it practical and exam-focused.`,
  );

  const topics = Array.isArray(result.topics) ? result.topics.slice(0, 12) : [];
  return {
    title: (result.title || body.planTitle || "StudyBody roadmap").toString(),
    course_outline: (result.course_outline || body.courseOutline || "").toString(),
    source_type: ["uploaded", "generated", "mixed"].includes(result.source_type as string)
      ? result.source_type
      : body.courseOutline
        ? "mixed"
        : "generated",
    topics,
  };
}

const QUESTION_SYSTEM = `You are StudyBody's question generator. You write exam questions STRICTLY from the uploaded textbook excerpts and nothing else.
Hard rules:
- Every question, its correct answer, and its explanation must be fully answerable using ONLY the provided excerpts. Do not use outside knowledge.
- Every question MUST include at least one source_refs entry that points to the excerpt it came from, using the file name and the exact [Page ...] / [Chunk ...] label shown in that excerpt.
- NEVER fabricate or guess a page number or label. Only cite a [Page ...] / [Chunk ...] label that literally appears in the excerpts below. If you cannot point to a real label, do not produce that question.
- If the excerpts do not contain enough material for the requested number of questions, return FEWER questions instead of inventing any. It is correct to return an empty list when the material does not cover the topic.
- Never repeat or lightly reword a question listed under "Already asked".
Return strict JSON only.`;

function hasSourceRef(item: unknown): boolean {
  const refs = (item as { source_refs?: unknown }).source_refs;
  return Array.isArray(refs) && refs.length > 0;
}

function questionUserPrompt(
  body: Body,
  type: "mcq" | "essay",
  count: number,
  exclude: string[],
  difficulty: DifficultyLevel,
): string {
  return `${profileBlock(body.profile)}

Topic:
${JSON.stringify(body.topic || {}, null, 2)}

Question type requested: ${type} (ALL questions in this batch must be "${type}")
Number of questions: ${count}

${difficultyInstruction(difficulty)}
Set the "difficulty" field of every question in this batch to "${difficulty}".

Already asked (do NOT repeat or paraphrase these):
${exclude.length ? exclude.map((p, i) => `${i + 1}. ${p}`).join("\n") : "(none yet)"}

Uploaded textbook excerpts (the ONLY allowed source):
${documentContext(body.documents)}

Return JSON:
{
  "questions": [
    {
      "type": "${type}",
      "prompt": "question text grounded in the excerpts",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],
      "correct_answer": "A or ideal essay answer",
      "explanation": "explanation that quotes/points to the source excerpt",
      "rubric": ["point 1", "point 2"],
      "difficulty": "easy" | "medium" | "hard",
      "source_refs": [{"file":"name", "page":"Page N, or omit if the excerpt has no page"}]
    }
  ]
}
For MCQ, provide exactly four options and one correct option id. For essay, options must be [].`;
}

// Large sets (e.g. 50 MCQs) overflow a single DeepSeek response, so generate in
// batches and accumulate, feeding already-asked prompts forward each round so we
// don't repeat. Stops early when the material is exhausted.
async function generateOneType(
  body: Body,
  deepSeekKey: string,
  type: "mcq" | "essay",
  target: number,
  seedExclude: string[],
): Promise<Record<string, unknown>[]> {
  if (target <= 0) return [];
  const batchSize = 20;
  const maxBatches = Math.ceil(target / batchSize) + 1;
  // Prefer the student's explicit level; fall back to mapping the adaptive hint.
  const difficulty: DifficultyLevel = body.difficulty
    ? body.difficulty
    : body.difficultyHint === "easier"
      ? "easy"
      : body.difficultyHint === "harder"
        ? "hard"
        : "medium";
  const collected: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const exclude = [...seedExclude];

  // Normalised so two questions differing only by whitespace, case or trailing
  // punctuation count as the same one.
  const key = (q: Record<string, unknown>) =>
    typeof q.prompt === "string"
      ? q.prompt.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
      : "";

  const absorb = (raw: Record<string, unknown>[]): number => {
    const grounded = raw.filter(hasSourceRef);
    const picked = grounded.length ? grounded : raw;
    let added = 0;
    for (const question of picked) {
      const k = key(question);
      if (k && seen.has(k)) continue;   // a duplicate across parallel batches
      if (k) seen.add(k);
      collected.push({ ...question, type });
      if (typeof question.prompt === "string") exclude.push(question.prompt);
      added += 1;
    }
    return added;
  };

  // ONE ROUND, RUN IN PARALLEL.
  //
  // These batches used to run one after another, each passing the previous
  // batch's prompts forward as `exclude` so the model would not repeat itself.
  // Correct, and far too slow to survive: fifty questions is three chained
  // DeepSeek calls at roughly a minute each, against a client that gives up at
  // 130 seconds and an edge runtime with its own ceiling above that. Fifty
  // simply could not be asked for.
  //
  // Run concurrently and the wall-clock cost of three batches is the cost of
  // one. The price is that parallel batches cannot see each other's output, so
  // they will sometimes land on the same question - which is why absorb()
  // de-duplicates on a normalised prompt rather than trusting `exclude` alone.
  // A duplicate costs one question from the batch, not the request.
  const rounds = Math.ceil(target / batchSize);

  // INSTRUMENTED ON PURPOSE. Whether these batches genuinely run at the same
  // time is not something the code can assert - the provider may serialise them
  // behind a rate limit, in which case concurrency buys nothing and only adds
  // duplicate risk. Each batch logs when it started and how long it took,
  // relative to the same origin, so the answer is readable off one request:
  // starts clustered near 0ms with similar durations means truly parallel;
  // starts staggered by roughly one batch-duration means throttled.
  const t0 = Date.now();
  const first = await Promise.all(
    Array.from({ length: rounds }, (_, i) => {
      // THIS ROUND'S SHARE, not a full batch every time. The sequential loop
      // this replaced asked for `min(batchSize, target - collected)`, so a
      // request for ten questions asked the model for ten. Passing batchSize
      // here instead made every round ask for twenty and discard the surplus —
      // a ten-question set became a twenty-question generation, and everything
      // got about twice as slow, My Coach included. The last round takes the
      // remainder.
      const need = Math.min(batchSize, target - i * batchSize);
      const startedAt = Date.now() - t0;
      return callDeepSeekJson(
        deepSeekKey,
        QUESTION_SYSTEM,
        questionUserPrompt(body, type, need, exclude, difficulty),
      )
        .then((r) => {
          console.log(
            `studybody: batch ${i + 1}/${rounds} ok start=+${startedAt}ms dur=${Date.now() - t0 - startedAt}ms`,
          );
          return r;
        })
        // A failed batch must not take the others down: nine questions beat an
        // error, and the top-up below can recover the shortfall.
        .catch((err) => {
          console.error(
            `studybody: batch ${i + 1}/${rounds} FAILED start=+${startedAt}ms dur=${Date.now() - t0 - startedAt}ms err=${err?.message ?? err}`,
          );
          return { questions: [] as Record<string, unknown>[] };
        });
    }),
  );
  console.log(
    `studybody: ${rounds} batch(es) for ${target} ${type} finished in ${Date.now() - t0}ms`,
  );
  for (const result of first) {
    absorb(Array.isArray(result.questions) ? (result.questions as Record<string, unknown>[]) : []);
  }

  // Top up sequentially if duplicates or a failed batch left us short. This is
  // the old behaviour, now the exception rather than the rule, and it CAN see
  // everything collected so far - so it is the reliable way to close a gap.
  for (let batch = 0; batch < maxBatches && collected.length < target; batch += 1) {
    const need = Math.min(batchSize, target - collected.length);
    const result = await callDeepSeekJson(
      deepSeekKey,
      QUESTION_SYSTEM,
      questionUserPrompt(body, type, need, exclude, difficulty),
    ).catch(() => ({ questions: [] as Record<string, unknown>[] }));
    const raw = Array.isArray(result.questions)
      ? (result.questions as Record<string, unknown>[])
      : [];
    if (raw.length === 0) break;          // material exhausted, or the call failed
    if (absorb(raw) === 0) break;         // only repeats coming back now
  }

  return collected.slice(0, target);
}

async function generateQuestions(body: Body, deepSeekKey: string) {
  const type = body.questionType || "mcq";
  const seedExclude = (body.excludePrompts || []).filter((p) => typeof p === "string" && p.trim());

  if (type === "mixed") {
    const mcqTarget = Math.min(Math.max(body.mcqCount || 0, 0), 100);
    const essayTarget = Math.min(Math.max(body.essayCount || 0, 0), 100);
    const mcqs = await generateOneType(body, deepSeekKey, "mcq", mcqTarget, seedExclude);
    const essayExclude = [
      ...seedExclude,
      ...mcqs.map((q) => q.prompt).filter((p): p is string => typeof p === "string"),
    ];
    const essays = await generateOneType(body, deepSeekKey, "essay", essayTarget, essayExclude);
    return { questions: [...mcqs, ...essays] };
  }

  const target = Math.min(Math.max(body.count || 5, 1), 100);
  const onlyType = type === "essay" ? "essay" : "mcq";
  const questions = await generateOneType(body, deepSeekKey, onlyType, target, seedExclude);
  return { questions };
}

const FLASHCARD_SYSTEM = `You are StudyBody's flashcard generator. You write study flashcards STRICTLY from the uploaded textbook excerpts and nothing else.
Hard rules:
- Each card's front (a question or prompt) and back (the answer) must be fully answerable using ONLY the provided excerpts. Do not use outside knowledge.
- Every card MUST include at least one source_refs entry citing the file name and the exact [Page ...] / [Chunk ...] label shown in that excerpt. Never invent a label.
- Keep the back concise (1-3 sentences) and self-contained.
- If the excerpts do not cover enough for the requested number, return FEWER cards instead of inventing any.
- Never repeat or lightly reword a card front listed under "Already made".
Return strict JSON only.`;

async function generateFlashcards(body: Body, deepSeekKey: string) {
  const target = Math.min(Math.max(body.count || 10, 1), 100);
  const batchSize = 30;
  const maxBatches = Math.ceil(target / batchSize) + 1;
  const collected: Record<string, unknown>[] = [];
  const exclude = (body.excludePrompts || []).filter((p) => typeof p === "string" && p.trim());

  for (let batch = 0; batch < maxBatches && collected.length < target; batch += 1) {
    const need = Math.min(batchSize, target - collected.length);
    const result = await callDeepSeekJson(
      deepSeekKey,
      FLASHCARD_SYSTEM,
      `${profileBlock(body.profile)}

Topic:
${JSON.stringify(body.topic || {}, null, 2)}

Number of flashcards: ${need}

Already made (do NOT repeat or paraphrase these fronts):
${exclude.length ? exclude.map((p, i) => `${i + 1}. ${p}`).join("\n") : "(none yet)"}

Uploaded textbook excerpts (the ONLY allowed source):
${documentContext(body.documents)}

Return JSON:
{
  "flashcards": [
    {
      "front": "a question or prompt grounded in the excerpts",
      "back": "the concise answer from the excerpts",
      "source_refs": [{"file":"name", "page":"Page N, or omit if the excerpt has no page"}]
    }
  ]
}`,
    );
    const raw = Array.isArray(result.flashcards)
      ? (result.flashcards as Record<string, unknown>[])
      : [];
    const grounded = raw.filter(hasSourceRef);
    const picked = grounded.length ? grounded : raw;
    if (picked.length === 0) break;

    for (const card of picked) {
      collected.push(card);
      const front = card.front;
      if (typeof front === "string") exclude.push(front);
    }
  }

  return { flashcards: collected.slice(0, target) };
}

async function reviewAnswers(body: Body, deepSeekKey: string) {
  const mode = body.mode || "Simplified";
  const result = await callDeepSeekJson(
    deepSeekKey,
    `You are StudyBody's grading AND coaching engine. DeepSeek does all of the work here.
Grade the student's answers strictly against the supplied answer keys and rubrics, then write the coaching in the student's chosen style.
Honesty rules:
- Do not introduce facts beyond the questions, answer keys, and rubrics provided.
- When you reference a fact in your feedback or coaching, cite the page/label from that question's source_refs (e.g. "see Page 12").
- If something the student asks about or that you would explain is NOT covered by the provided material, say plainly "This wasn't found in your uploaded material" instead of guessing or using outside knowledge.
Return strict JSON only.`,
    `${profileBlock(body.profile)}
Coaching style: ${mode}

Questions:
${JSON.stringify(body.questions || [], null, 2)}

Student answers:
${JSON.stringify(body.answers || {}, null, 2)}

Return JSON:
{
  "score": 0,
  "total": 0,
  "percentage": 0,
  "answers": [
    {
      "question_id": "id from question if present",
      "is_correct": true,
      "score": 1,
      "feedback": "specific correction",
      "missing_points": ["missing point"]
    }
  ],
  "weak_areas": ["topic weakness"],
  "next_steps": ["what to revise next"],
  "coaching": "A concise written review in the ${mode} style covering: the score, the strongest area, the weakest area, the corrected approach, and the single next study step. Plain text, no markdown headers."
}`,
  );

  const coaching = (result.coaching ?? "").toString().trim();
  const grading = { ...result };
  delete (grading as Record<string, unknown>).coaching;
  return { grading, coaching };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as Body;
    const deepSeekKey = Deno.env.get("DEEPSEEK_API_KEY");

    if (!deepSeekKey) return jsonResponse({ error: "DeepSeek API key not configured" }, 500);

    if (body.action === "generate_plan") {
      if (!hasUsableDocuments(body.documents) && !(body.courseOutline || "").trim()) {
        return jsonResponse(
          {
            error:
              "No readable text found in the selected files. Re-upload them (scanned PDFs need OCR) or paste a course outline.",
          },
          400,
        );
      }
      return jsonResponse(await generatePlan(body, deepSeekKey));
    }

    if (body.action === "generate_questions") {
      if (!hasUsableDocuments(body.documents)) {
        return jsonResponse(
          {
            error:
              "StudyBody can only ask questions from your file's text, but no readable text was found. Re-upload the file (scanned PDFs need OCR).",
          },
          400,
        );
      }
      return jsonResponse(await generateQuestions(body, deepSeekKey));
    }

    if (body.action === "generate_flashcards") {
      if (!hasUsableDocuments(body.documents)) {
        return jsonResponse(
          {
            error:
              "My Coach can only build flashcards from your file's text, but no readable text was found. Re-upload the file (scanned PDFs need OCR).",
          },
          400,
        );
      }
      return jsonResponse(await generateFlashcards(body, deepSeekKey));
    }

    if (body.action === "review_answers") {
      return jsonResponse(await reviewAnswers(body, deepSeekKey));
    }

    return jsonResponse({ error: "Unknown StudyBody action" }, 400);
  } catch (e) {
    console.error("studybody error:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
