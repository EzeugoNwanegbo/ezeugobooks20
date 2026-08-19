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
  // Opt-in only. generate_questions and generate_flashcards accumulate their
  // whole result in memory today either way (a batch either lands in
  // `collected` or it doesn't) - `stream` only changes HOW that accumulation
  // is reported to the caller: as one JSON blob at the very end (the default,
  // unchanged for any caller that omits this), or as a sequence of SSE frames
  // emitted as each batch actually finishes. See generationStreamResponse().
  stream?: boolean;
}

type DifficultyLevel = "easy" | "medium" | "hard";

// The distractor half of HARD, kept out of the template literal below so the
// essay path is not shipped a page of option rules it must ignore. This is the
// part that answers "the options are not confusing enough": it names the four
// constructions a real trap is built from, and bans the surface tells (length,
// hedging, book phrasing, absolutes) that let a student pick the answer without
// having read anything.
const HARD_OPTION_RULES = `
- There are three options and only three, so all three carry weight. ONE is defensible; the OTHER TWO must each be a trap a well-prepared student would seriously consider. A wasted option turns this into a coin flip.
- Build EVERY distractor from the excerpts, using one of these four moves: (a) a statement that is TRUE in the material but does not answer THIS question; (b) the right idea applied to the wrong condition, stage, case or population; (c) a near-miss that changes exactly one decisive detail - a number, a direction, an order, a qualifier; (d) the precise misconception the material exists to correct.
- Never invent a nonsense, off-topic or absurd option. If a student can strike an option out without knowing the material, that option is broken - rewrite it.
- Make the options SURFACE-IDENTICAL: same length (within a few words), same grammatical form, same level of detail, same technical vocabulary. The correct answer must NEVER be the longest, the most detailed, the most hedged, or the only one written in the book's exact phrasing.
- No "all of the above", no "none of the above", and no absolutes ("always", "never", "only") that appear only in the wrong options.
- Choosing between the best two options must turn on ONE specific fact from the excerpts - not on general reasoning, tone or plausibility.
- Vary which option id is correct across the batch. Do not settle on A.

SELF-CHECK BEFORE RETURNING - rewrite anything that fails:
1. Could someone who never read the material eliminate any option from its wording alone? Then that option is too weak.
2. Is any distractor obviously false or off-topic? Then it is wasted - replace it with a real trap.
3. Does one sentence of one excerpt answer the stem outright? Then the question is too easy.
4. The explanation must name the trap: in ONE or TWO sentences, why the correct option holds AND why the most tempting wrong one fails.
`;

// The written-answer half. An essay has no distractors to confuse, so hard here
// means the ANSWER has to be built rather than recalled: several parts, in a
// defensible order, with the reasoning shown.
const HARD_ESSAY_RULES = `
THE ANSWER (what a full-mark response must contain):
- The ideal answer must have SEVERAL distinct parts drawn from different excerpts. A question a strong student can finish in one sentence is not hard.
- Demand reasoning, not a list: make them justify, compare, rank, explain a mechanism, or resolve an apparent contradiction in the material.
- Where the material sets conditions or exceptions, the question should be built so that missing them costs marks.
- The rubric must contain the specific points a marker looks for, including the subtle one most students will leave out.
`;

// Absolute, student-chosen difficulty. "hard" must be genuinely punishing while
// staying 100% answerable from the excerpts - never reaching outside the files.
//
// HARD IS SPELLED OUT MECHANICALLY ON PURPOSE. "Make these extremely
// challenging" is the kind of instruction a model agrees with and then ignores:
// it returns a recall question with two throwaway distractors and calls it hard.
// What actually makes an exam question hard is not the topic, it is (a) a stem
// that cannot be answered by finding one sentence, and (b) options that are all
// defensible until you know the one fact that separates them. So the rules below
// name the specific distractor constructions to use, ban the surface tells that
// let a student pick the answer without reading the material, and end with a
// self-check the model has to apply before returning.
//
// Takes the question type because most of that is about DISTRACTORS, and a batch
// of essays has none - sending an essay batch a page of option-writing rules is
// input spent to describe a field the model is told to return empty. Each type
// gets the half that applies to it.
function difficultyInstruction(level: DifficultyLevel, type: "mcq" | "essay"): string {
  if (level === "easy") {
    // Written as its own line rather than an inline escape so the prompt text
    // stays readable in the source.
    const distractorLine =
      type === "mcq" ? "- Make every distractor clearly wrong to someone who read the material." : "";
    return `DIFFICULTY: EASY.
- Test direct recall and recognition of facts that are stated plainly in the excerpts.
- One step to answer. Use clear, unambiguous wording.
${distractorLine}`.trim();
  }
  if (level === "hard") {
    return `DIFFICULTY: HARD - exam-topper level. Your target: a student who read the material once and understood it shallowly must get this WRONG. A student who genuinely understands it must get it right without guessing.

THE QUESTION (stem):
- Do NOT ask what something is. Ask what FOLLOWS from it: give a concrete scenario, case, dataset or worked situation and ask for the consequence, the mechanism, the exception, the next step, or the best explanation.
- Every question must require combining at least TWO separate facts from the excerpts. If a single sentence of the material answers it, it is too easy - rewrite it.
- Mine the hard parts of the material: exceptions, conditions ("only when...", "unless..."), thresholds and limits, ordering and precedence, mechanisms, and any point the text itself flags as commonly confused.
- Precise, unpadded wording. Never define a term in the stem that the answer depends on, and never hint at the answer.
${type === "essay" ? HARD_ESSAY_RULES : HARD_OPTION_RULES}
ABSOLUTE GROUNDING RULE: despite the difficulty, every question, the correct answer, every distractor, and the explanation must remain fully verifiable from the provided excerpts ONLY. Do NOT pull in any fact, term, or scenario that is not in the files. Hard means deeper use of the material, never outside material.`;
  }
  return `DIFFICULTY: MEDIUM.
- Test understanding and application, not just recall: require interpreting or applying a fact from the excerpts.
- Two related ideas may be combined. Distractors should be plausible but resolvable from the material.`;
}

// Was 100,000 (~25k tokens). The "docCharBudget" comment on
// createStraightInSession already proved the failure mode this causes: a
// whole-file pull fills the ceiling, the model spends its output budget
// reading before it writes a single question, and the call returns an empty
// completion or times out ("A ten-question battle scoped to ONE TOPIC
// generated fine while the same ten questions over the whole file failed").
// Battle Royale worked around it client-side by capping at 12,000. This cuts
// the SERVER'S default in the same direction for every caller - prefill and
// reasoning-over-context both scale with input size, so a smaller prompt is a
// faster prompt everywhere, not just for the caller that remembered to ask
// for one. 60,000 stays far more generous than Battle Royale's 12,000 - My
// Coach's roadmap building and topic-scoped practice need the extra breadth -
// while still being a real cut for "Go straight in" over a whole large file,
// which never set docCharBudget and always hit the old ceiling.
const MAX_DOC_CHARS_TOTAL = 60_000;
const DEEPSEEK_TIMEOUT_MS = 90_000;
// Only used to rescue a batch DeepSeek already failed (bad JSON, empty
// completion, or a 5xx) - see callWithFallback. Kept short and separate from
// DEEPSEEK_TIMEOUT_MS: this fires AFTER a DeepSeek attempt already spent up to
// 90s, and both clients give up at 145s total, so the fallback has roughly 50s
// of real budget before ITS timeout has to be the one that fires instead of a
// clean recovery.
const OPENAI_FALLBACK_TIMEOUT_MS = 30_000;

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

// ─── Streaming (opt-in) ─────────────────────────────────────────────────────
//
// Mirrors chat/index.ts's SSE envelope: `data: {...}\n\n` frames, a bare `:
// comment\n\n` line for a keep-alive that carries no data, and a terminal
// `data: [DONE]\n\n`. Reusing that exact shape (rather than inventing a
// second one) is why the client-side parser in studybody-client.ts can be a
// near copy of chat-client.ts's proven SSE reader.
//
// WHY THIS EXISTS: a 20-30 question set used to be one silent request that
// held the connection open for the full duration of every DeepSeek batch
// before writing a single byte back. That is indistinguishable, from the
// wire, from a hung connection - and both clients give up at 130s
// (STUDYBODY_TIMEOUT_MS) while the Supabase Edge Function itself is capped
// around 150s on the free plan regardless. Streaming does not raise either of
// those ceilings. What it changes is what happens AT them: instead of an
// all-or-nothing blob that a timeout turns into a total loss, the batches
// that already finished are already in the client's hands, frame by frame, so
// a request that times out with 18 of 30 questions made can still hand the
// student those 18 instead of nothing.
const STUDYBODY_HEARTBEAT_MS = 10_000;

/**
 * Runs `run`, relaying whatever it reports through `onBatch` as individual
 * SSE frames, then emits one final frame built by `toDone` from its return
 * value, then the [DONE] sentinel. Errors thrown by `run` are caught and sent
 * as an `{event:"error"}` frame rather than a non-200 status: by the time
 * `run` is even invoked the Response has already committed to
 * `text/event-stream` with a 200, the same constraint chat/index.ts's own
 * visualStreamResponse works under.
 *
 * The heartbeat comment is NOT redundant with the batch frames. Two batches
 * of 20 running concurrently (see generateOneType's "ONE ROUND, RUN IN
 * PARALLEL" comment) both take up to DEEPSEEK_TIMEOUT_MS with nothing to
 * report until the first one resolves - a real gap of up to 90s with zero
 * batch frames to send. The heartbeat is what keeps THAT gap from reading as
 * a dead connection to whatever sits between here and the client (a proxy, a
 * mobile carrier's NAT, Hostinger's own front door) - the same reason
 * chat/index.ts's visualStreamResponse pings every 12s across its own single,
 * long DeepSeek call.
 */
function generationStreamResponse<T>(
  run: (
    onBatch: (added: Record<string, unknown>[], made: number, target: number) => void,
  ) => Promise<T>,
  toDone: (result: T) => Record<string, unknown>,
): Response {
  const encoder = new TextEncoder();
  // Deno types setInterval as returning Timeout, not the DOM's number.
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Client already disconnected - nothing left to enqueue to. The
          // generation already in flight is left to run to completion and be
          // discarded rather than aborted, matching visualStreamResponse.
        }
      };

      controller.enqueue(encoder.encode(": studybody-start\n\n"));
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": studybody-working\n\n"));
        } catch {
          if (heartbeat !== undefined) clearInterval(heartbeat);
        }
      }, STUDYBODY_HEARTBEAT_MS);

      (async () => {
        try {
          const result = await run((added, made, target) =>
            emit({ event: "batch", items: added, made, target }),
          );
          emit({ event: "done", ...toDone(result) });
        } catch (err) {
          console.error("studybody stream error:", err);
          emit({
            event: "error",
            error: err instanceof Error ? err.message : "Unknown error",
          });
        } finally {
          if (heartbeat !== undefined) clearInterval(heartbeat);
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
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
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

/**
 * Second-lane provider, used ONLY to rescue a batch DeepSeek already failed -
 * never dispatched alongside DeepSeek "just in case". OpenAI bills materially
 * more per token, so paying for it on every batch would trade a speed problem
 * for a cost one; paying for it only when DeepSeek already threw (malformed
 * JSON mid-array, an empty completion, a 5xx) is nearly free because it is
 * rare, and it turns those failures into a recovered batch instead of a
 * shortfall the sequential top-up loop has to spend another ~90s chasing from
 * the same provider that just failed.
 *
 * gpt-5-nano (also DeepSeek's stand-in elsewhere in this codebase, see
 * chat/index.ts) rather than the deep model: this is a rescue, not the
 * primary path, so cheapest-and-fastest wins over quality headroom. No
 * `response_format` - chat/index.ts never sets it for this model family
 * either, and parseJsonObject already tolerates a fenced or loosely-wrapped
 * reply via its regex/salvage fallback, so there is nothing to gain from
 * relying on strict JSON mode and a small risk of a 400 if the family's
 * support for it ever changes.
 */
async function callOpenAIJson(
  apiKey: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const model = Deno.env.get("OPENAI_FALLBACK_MODEL") || "gpt-5-nano";
  const response = await fetchWithTimeout(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        // GPT-5 renamed max_tokens and rejects temperature outright - same
        // constraints documented in chat/index.ts's callOpenAISync.
        max_completion_tokens: 8192,
        reasoning_effort: "minimal",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    },
    timeoutMs,
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI fallback error ${response.status}: ${text}`);
  }

  const json = await response.json();
  const choice = json.choices?.[0];
  const content: string = choice?.message?.content ?? "";
  if (!content.trim()) {
    throw new Error(`OpenAI fallback returned an empty response (${choice?.finish_reason ?? "unknown"})`);
  }
  return parseJsonObject(content);
}

/**
 * DeepSeek first, OpenAI only if DeepSeek throws. Used by the sequential
 * top-up loops (generateOneType's shortfall recovery, generateFlashcards),
 * deliberately NOT the initial parallel round in generateOneType - that round
 * is the common case, already bounded by DEEPSEEK_TIMEOUT_MS, and adding a
 * second provider hop to its worst-case path would risk stacking two timeouts
 * past the 130s the clients give up at. Top-up already accepts the extra
 * latency as the exception path, so this is where a rescue pays for itself
 * without threatening the fast path.
 */
async function callWithFallback(
  deepSeekKey: string,
  openAiKey: string | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  try {
    return await callDeepSeekJson(deepSeekKey, systemPrompt, userPrompt);
  } catch (err) {
    if (!openAiKey) throw err;
    console.warn(
      `studybody: DeepSeek batch failed (${err instanceof Error ? err.message : err}), retrying via OpenAI fallback`,
    );
    return await callOpenAIJson(openAiKey, systemPrompt, userPrompt, OPENAI_FALLBACK_TIMEOUT_MS);
  }
}

/**
 * WHICH PROVIDER WRITES THE QUESTIONS.
 *
 * Set QUESTION_PROVIDER to "deepseek" to put it back; anything else (including
 * unset) uses OpenAI. An env var rather than a code constant so the choice can
 * be reversed from the dashboard without a deploy — this is a taste-and-speed
 * decision the owner may want to take back after seeing a set.
 *
 * WHY OPENAI IS THE DEFAULT HERE. The progress bar settled a question that
 * guesswork could not: on a thirty-question set it moves 0 → 10 → 29, so the
 * batches ARE landing concurrently and the remaining wait is simply how long
 * the model takes to WRITE ten questions. No further batching, trimming or
 * parallelism addresses that — only a faster writer does.
 *
 * deepseek-v4-pro appears to be a reasoning model: it thinks before it writes,
 * and that thinking is invisible, billed against the same budget, and slow.
 * gpt-5-nano with reasoning_effort "minimal" (already this codebase's fast tier
 * in chat/index.ts) skips most of it. Nano is the cheap tier at $0.05/$0.40 per
 * 1M, but generation is the heaviest AI workload here, so this IS a real cost
 * change and not a free win.
 *
 * The loser of this choice becomes the rescue, so a failure on either side is
 * still covered by the other.
 */
function questionProvider(): "deepseek" | "openai" {
  return (Deno.env.get("QUESTION_PROVIDER") || "openai").toLowerCase() === "deepseek"
    ? "deepseek"
    : "openai";
}

/**
 * A generation batch, sent to whichever provider is primary, falling back to
 * the other. Same contract as callWithFallback — this only changes who is
 * asked first.
 *
 * The primary gets the full DEEPSEEK_TIMEOUT_MS budget whichever it is: the
 * short OPENAI_FALLBACK_TIMEOUT_MS exists because a RESCUE starts after another
 * attempt already burned most of the clock, and that reasoning does not apply
 * to the first call.
 */
async function callGenerationJson(
  deepSeekKey: string,
  openAiKey: string | undefined,
  systemPrompt: string,
  userPrompt: string,
): Promise<Record<string, unknown>> {
  if (questionProvider() === "openai" && openAiKey) {
    try {
      return await callOpenAIJson(openAiKey, systemPrompt, userPrompt, DEEPSEEK_TIMEOUT_MS);
    } catch (err) {
      console.warn(
        `studybody: OpenAI batch failed (${err instanceof Error ? err.message : err}), retrying via DeepSeek`,
      );
      return await callDeepSeekJson(deepSeekKey, systemPrompt, userPrompt);
    }
  }
  return await callWithFallback(deepSeekKey, openAiKey, systemPrompt, userPrompt);
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

${difficultyInstruction(difficulty, type)}

Already asked (do NOT repeat or paraphrase these):
${exclude.length ? exclude.map((p, i) => `${i + 1}. ${p}`).join("\n") : "(none yet)"}

Uploaded textbook excerpts (the ONLY allowed source):
${documentContext(body.documents)}

Return JSON:
{
  "questions": [
${type === "mcq" ? mcqShape(difficulty) : ESSAY_SHAPE}
  ]
}
${
  type === "mcq"
    ? `Exactly three options, one correct option id. "correct_answer" is that option's id - vary which one it is across the batch, do not always answer "A".`
    : "options must be []. correct_answer is the ideal written answer."
}`;
}

// ── WHAT WE ASK THE MODEL TO WRITE ──────────────────────────────────────────
//
// Generation time is dominated by OUTPUT tokens, so every field in this shape
// is paid for on every question. Three were being paid for and thrown away:
//
//   "type"       generateOneType overwrites it (`{ ...question, type }`) - the
//                caller asked for one type and gets one type, so the model
//                echoing it back was never read.
//   "difficulty" the caller chooses the level for the whole batch, and the
//                clients already fall back to it (`q.difficulty ?? difficulty`).
//                A per-question copy of a constant.
//   "rubric"     a list of marking points for grading written answers. An MCQ
//                is graded by matching correct_answer, so on an MCQ this is
//                pure ceremony - and Battle Royale is MCQ ONLY, so it paid for
//                it on every single question.
//
// The explanation is also bounded now. It was "explanation that quotes/points
// to the source excerpt" with no length, and models answer that with a
// paragraph; one or two sentences teaches just as well and costs a fraction.
//
// This is the cheapest speed available: the same questions, less writing. It
// does not touch what a student sees beyond shorter explanations, and it makes
// every count faster rather than only rescuing the large ones.
//
// Still three options at every level - the shape is a function only because the
// explanation differs at hard: same one-or-two-sentence budget, spent on naming
// the trap (why the tempting wrong option fails) rather than only restating the
// source. When both wrong options are meant to be believable, "why not that one"
// is the part the student actually needs back.
function mcqShape(level: DifficultyLevel): string {
  const explanation = level === "hard"
    ? "ONE or TWO sentences: why the correct option holds and why the most tempting wrong option fails, pointing at the source excerpt"
    : "ONE or TWO sentences, pointing at the source excerpt";
  return `    {
      "prompt": "question text grounded in the excerpts",
      "options": [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."}],
      "correct_answer": "A",
      "explanation": "${explanation}",
      "source_refs": [{"file":"name", "page":"Page N, or omit if the excerpt has no page"}]
    }`;
}

// Essays keep the rubric: it is what review_answers grades the written answer
// against, so here it is load-bearing rather than ceremony.
const ESSAY_SHAPE = `    {
      "prompt": "question text grounded in the excerpts",
      "options": [],
      "correct_answer": "the ideal answer",
      "explanation": "ONE or TWO sentences, pointing at the source excerpt",
      "rubric": ["point 1", "point 2"],
      "source_refs": [{"file":"name", "page":"Page N, or omit if the excerpt has no page"}]
    }`;

// Large sets (e.g. 50 MCQs) overflow a single DeepSeek response, so generate in
// batches and accumulate, feeding already-asked prompts forward each round so we
// don't repeat. Stops early when the material is exhausted.
async function generateOneType(
  body: Body,
  deepSeekKey: string,
  openAiKey: string | undefined,
  type: "mcq" | "essay",
  target: number,
  seedExclude: string[],
  // Fired once per batch that actually added something, streaming or not -
  // the caller decides whether to do anything with it. Kept optional so the
  // non-streaming callers (and every call site before this existed) need no
  // changes at all.
  onBatch?: (added: Record<string, unknown>[]) => void,
): Promise<Record<string, unknown>[]> {
  if (target <= 0) return [];
  // TEN, not twenty. Each round's wall-clock is dominated by how much the model
  // has to WRITE, so halving the batch halves the longest single call - and the
  // rounds run concurrently, so more of them costs no extra time when the
  // provider honours the concurrency. Thirty questions becomes three short
  // rounds instead of two long ones, which is the difference between finishing
  // inside the platform's ceiling and being killed at it.
  //
  // The trade is more simultaneous calls (fifty questions is five), so if the
  // provider rate-limits concurrency this trades a timeout for a throttle. That
  // is the better failure: a throttled batch returns something, and the
  // sequential top-up can close the gap.
  const batchSize = 10;
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

  // Returns the items actually added (not just a count) so a streaming caller
  // can hand the real objects to onBatch instead of re-deriving them from a
  // count against `collected`, which concurrent batches would race on.
  const absorb = (raw: Record<string, unknown>[]): Record<string, unknown>[] => {
    const grounded = raw.filter(hasSourceRef);
    const picked = grounded.length ? grounded : raw;
    const added: Record<string, unknown>[] = [];
    for (const question of picked) {
      const k = key(question);
      if (k && seen.has(k)) continue;   // a duplicate across parallel batches
      if (k) seen.add(k);
      // `type` and `difficulty` are stamped HERE rather than asked for. Both
      // are constants for the whole batch — the caller named them — so making
      // the model write them on every question was output tokens spent to be
      // told something we already knew. Stamping keeps every stored row's shape
      // exactly as it was, so nothing downstream notices the prompt got cheaper.
      const withType = { ...question, type, difficulty };
      collected.push(withType);
      if (typeof question.prompt === "string") exclude.push(question.prompt);
      added.push(withType);
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
  await Promise.all(
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
      return callGenerationJson(
        deepSeekKey,
        openAiKey,
        QUESTION_SYSTEM,
        questionUserPrompt(body, type, need, exclude, difficulty),
      )
        .then((r) => {
          console.log(
            `studybody: batch ${i + 1}/${rounds} ok start=+${startedAt}ms dur=${Date.now() - t0 - startedAt}ms`,
          );
          const raw = Array.isArray(r.questions) ? (r.questions as Record<string, unknown>[]) : [];
          // ABSORBED AND REPORTED THE MOMENT THIS ONE BATCH RESOLVES, not after
          // every parallel round in this Promise.all has finished. That is the
          // entire point of streaming per batch instead of per generateOneType
          // call: a caller that wants to render/report progress sees it the
          // instant it exists rather than waiting for the slowest sibling batch
          // too. Safe to mutate the shared collected/seen/exclude state from
          // several in-flight .then() handlers here because absorb() has no
          // `await` in it - the JS event loop still runs one handler fully to
          // completion before starting the next, so there is no interleaving.
          const added = absorb(raw);
          if (added.length) onBatch?.(added);
        })
        // A failed batch must not take the others down: nine questions beat an
        // error, and the top-up below can recover the shortfall.
        .catch((err) => {
          console.error(
            `studybody: batch ${i + 1}/${rounds} FAILED start=+${startedAt}ms dur=${Date.now() - t0 - startedAt}ms err=${err?.message ?? err}`,
          );
        });
    }),
  );
  console.log(
    `studybody: ${rounds} batch(es) for ${target} ${type} finished in ${Date.now() - t0}ms`,
  );

  // Top up sequentially if duplicates or a failed batch left us short. This is
  // the old behaviour, now the exception rather than the rule, and it CAN see
  // everything collected so far - so it is the reliable way to close a gap.
  for (let batch = 0; batch < maxBatches && collected.length < target; batch += 1) {
    const need = Math.min(batchSize, target - collected.length);
    const result = await callGenerationJson(
      deepSeekKey,
      openAiKey,
      QUESTION_SYSTEM,
      questionUserPrompt(body, type, need, exclude, difficulty),
    ).catch(() => ({ questions: [] as Record<string, unknown>[] }));
    const raw = Array.isArray(result.questions)
      ? (result.questions as Record<string, unknown>[])
      : [];
    if (raw.length === 0) break;          // material exhausted, or the call failed
    const added = absorb(raw);
    if (added.length === 0) break;        // only repeats coming back now
    onBatch?.(added);
  }

  return collected.slice(0, target);
}

async function generateQuestions(
  body: Body,
  deepSeekKey: string,
  openAiKey: string | undefined,
  // Local to generateOneType, "made"/"target" mean "this type's own count" -
  // mcq and essay each run their own generateOneType call with their own
  // target. A streaming caller wants ONE combined progress line ("14 of 20"),
  // not two resets, so this wraps generateOneType's per-type callback into a
  // single running total against the OVERALL target computed once below.
  onBatch?: (added: Record<string, unknown>[], made: number, target: number) => void,
) {
  const type = body.questionType || "mcq";
  const seedExclude = (body.excludePrompts || []).filter((p) => typeof p === "string" && p.trim());

  if (type === "mixed") {
    const mcqTarget = Math.min(Math.max(body.mcqCount || 0, 0), 100);
    const essayTarget = Math.min(Math.max(body.essayCount || 0, 0), 100);
    const overallTarget = mcqTarget + essayTarget;
    let made = 0;
    const relay = (added: Record<string, unknown>[]) => {
      made += added.length;
      onBatch?.(added, made, overallTarget);
    };
    const mcqs = await generateOneType(body, deepSeekKey, openAiKey, "mcq", mcqTarget, seedExclude, relay);
    const essayExclude = [
      ...seedExclude,
      ...mcqs.map((q) => q.prompt).filter((p): p is string => typeof p === "string"),
    ];
    const essays = await generateOneType(
      body,
      deepSeekKey,
      openAiKey,
      "essay",
      essayTarget,
      essayExclude,
      relay,
    );
    return { questions: [...mcqs, ...essays] };
  }

  const target = Math.min(Math.max(body.count || 5, 1), 100);
  const onlyType = type === "essay" ? "essay" : "mcq";
  let made = 0;
  const relay = (added: Record<string, unknown>[]) => {
    made += added.length;
    onBatch?.(added, made, target);
  };
  const questions = await generateOneType(body, deepSeekKey, openAiKey, onlyType, target, seedExclude, relay);
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

async function generateFlashcards(
  body: Body,
  deepSeekKey: string,
  openAiKey: string | undefined,
  onBatch?: (added: Record<string, unknown>[], made: number, target: number) => void,
) {
  const target = Math.min(Math.max(body.count || 10, 1), 100);
  const batchSize = 30;
  const maxBatches = Math.ceil(target / batchSize) + 1;
  const collected: Record<string, unknown>[] = [];
  const exclude = (body.excludePrompts || []).filter((p) => typeof p === "string" && p.trim());

  for (let batch = 0; batch < maxBatches && collected.length < target; batch += 1) {
    const need = Math.min(batchSize, target - collected.length);
    const result = await callWithFallback(
      deepSeekKey,
      openAiKey,
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
    onBatch?.(picked, collected.length, target);
  }

  return { flashcards: collected.slice(0, target) };
}

/**
 * Grade an all-MCQ set WITHOUT asking the model anything.
 *
 * An MCQ has one stored key and the student picked one option: correctness is a
 * string comparison, not a judgement. Sending the whole set to DeepSeek to be
 * told which letters match which letters cost a full model round trip on every
 * submit - and Battle Royale is MCQ ONLY, so a battle paid it every single
 * time. That is why submitting felt slow.
 *
 * Grading stays SERVER-SIDE, which is the property that actually matters: the
 * client still cannot mark its own contest. It is simply decided here by
 * comparison instead of by a language model.
 *
 * Returns null when anything in the set needs real judgement (an essay against
 * a rubric), in which case the model call below runs exactly as before.
 */
function gradeObjectively(body: Body): Record<string, unknown> | null {
  const questions = (body.questions || []) as Record<string, unknown>[];
  if (!questions.length) return null;
  // One written answer anywhere and the whole set goes the slow way: a mixed
  // set still needs the rubric grading, and splitting it would mean two grading
  // paths whose scores have to agree.
  if (questions.some((q) => q.type !== "mcq")) return null;

  const answers = (body.answers || {}) as Record<string, string>;
  const norm = (v: unknown) => String(v ?? "").trim().toUpperCase();

  let score = 0;
  const graded = questions.map((q) => {
    const id = String(q.id ?? "");
    const correct = norm(q.correct_answer);
    const given = norm(answers[id]);
    const isCorrect = Boolean(given) && given === correct;
    if (isCorrect) score += 1;
    return {
      question_id: id,
      is_correct: isCorrect,
      score: isCorrect ? 1 : 0,
      // The explanation was already written when the question was generated, so
      // the student still gets the "why" - it just is not re-written per
      // submission by a model that would only be paraphrasing it.
      feedback: isCorrect ? "" : String(q.explanation ?? ""),
      missing_points: [] as string[],
    };
  });

  const total = questions.length;
  return {
    score,
    total,
    percentage: total ? Math.round((score / total) * 100) : 0,
    answers: graded,
    weak_areas: [],
    next_steps: [],
  };
}

async function reviewAnswers(body: Body, deepSeekKey: string) {
  const mode = body.mode || "Simplified";

  // Same envelope the model path returns, so nothing downstream can tell which
  // way a set was graded. `coaching` is empty rather than invented: there is no
  // written review when no model wrote one, and a fabricated one would be worse
  // than none.
  const objective = gradeObjectively(body);
  if (objective) return { grading: objective, coaching: "" };

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
    // Optional: only gates the OpenAI rescue in callWithFallback. Already
    // configured project-wide for chat/index.ts and embed/index.ts, but stays
    // undefined-safe here so a missing key degrades to today's DeepSeek-only
    // behaviour instead of failing the whole request.
    const openAiKey = Deno.env.get("OPENAI_API_KEY") || undefined;

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
      // Opt-in: every real caller in this codebase now sets `stream: true` (see
      // studybody-client.ts on both platforms), but a caller that omits it -
      // present or future - gets EXACTLY today's behaviour, unchanged.
      if (body.stream) {
        return generationStreamResponse(
          (onBatch) => generateQuestions(body, deepSeekKey, openAiKey, onBatch),
          (result) => ({ questions: result.questions }),
        );
      }
      return jsonResponse(await generateQuestions(body, deepSeekKey, openAiKey));
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
      if (body.stream) {
        return generationStreamResponse(
          (onBatch) => generateFlashcards(body, deepSeekKey, openAiKey, onBatch),
          (result) => ({ flashcards: result.flashcards }),
        );
      }
      return jsonResponse(await generateFlashcards(body, deepSeekKey, openAiKey));
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
