// React Native's built-in fetch cannot read a streaming response body - same
// constraint chat-client.ts already documents and works around. generate_
// questions/generate_flashcards now stream (see supabase/functions/studybody/
// index.ts's generationStreamResponse), so this needs the same expo/fetch.
import { fetch as expoFetch } from "expo/fetch";
import { supabase, SUPABASE_URL_VALUE } from "./supabase";
import type { Profile } from "./auth";

const STUDYBODY_URL = `${SUPABASE_URL_VALUE}/functions/v1/studybody`;
// Supabase Edge Functions on the free plan cap wall-clock around 150s
// regardless of what the client does. This used to sit at a flat 130s for no
// stated reason beyond symmetry with the old (non-streaming) behaviour; now
// that a stalled generation degrades gracefully instead of losing everything
// (see streamStudyBody below), it is safe to wait almost the whole platform
// ceiling rather than giving up 20s early. 145s keeps a 5s margin under that
// ceiling so the client's own abort - which DOES send a clean error - fires
// before the platform kills the connection with none.
const STUDYBODY_TIMEOUT_MS = 145_000;

export type StudyQuestionType = "mcq" | "essay" | "mixed" | "flashcard";

export type StudyDocument = {
  id: string;
  file_name: string;
  folder?: string | null;
  excerpt: string;
};

export type GeneratedFlashcard = {
  front: string;
  back: string;
  source_refs?: unknown[];
};

export type StudyRoadmapTopic = {
  title: string;
  summary?: string;
  objectives?: string[];
  source_refs?: unknown[];
  estimated_minutes?: number;
};

export type GeneratedQuestion = {
  type: "mcq" | "essay";
  prompt: string;
  options?: { id: string; text: string }[];
  correct_answer: string;
  explanation?: string;
  rubric?: string[];
  difficulty?: string;
  source_refs?: unknown[];
};

export type StudyReview = {
  grading: {
    score?: number;
    total?: number;
    percentage?: number;
    answers?: {
      question_id?: string;
      is_correct?: boolean;
      score?: number;
      feedback?: string;
      missing_points?: string[];
    }[];
    weak_areas?: string[];
    next_steps?: string[];
  };
  coaching: string;
};

async function callStudyBody<T>(payload: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STUDYBODY_TIMEOUT_MS);

  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Sign in again before using StudyBody.");

    const response = await fetch(STUDYBODY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let message = "StudyBody AI request failed";
      try {
        const json = await response.json();
        message = json.error ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// How many of the requested items exist so far, out of how many were asked
// for. Fired once per completed AI batch - see generationStreamResponse in
// the edge function for exactly when that is.
export type GenerationProgress = { made: number; target: number };
export type OnGenerationProgress = (progress: GenerationProgress) => void;

/**
 * Streaming counterpart to callStudyBody, used by generate_questions and
 * generate_flashcards. Reads the same SSE envelope chat-client.ts's
 * streamChat already parses (`data: {...}\n\n` frames, a bare `:` comment for
 * the heartbeat, `data: [DONE]\n\n` to close) - see
 * supabase/functions/studybody/index.ts's generationStreamResponse for the
 * exact frames this sends: `{event:"batch", items, made, target}` as each
 * batch finishes, one `{event:"done", ...}` carrying the final canonical
 * list, or `{event:"error", error}` if generation failed partway through.
 *
 * WHY STREAM AT ALL, BEYOND THE PROGRESS BAR: a request that emits bytes
 * continuously is never mistaken for a dead connection by whatever sits
 * between here and the edge function - the same reason chat/index.ts's own
 * visuals pipeline pings a heartbeat across its own long single call. It also
 * turns an all-or-nothing timeout into a partial one: if the deadline is hit
 * with 3 of 5 batches in, those 3 batches' worth of questions already reached
 * this function via onProgress-adjacent `items`, even though this function's
 * own return value is still all-or-nothing (below) - a caller that wants the
 * partial set has the batch items available via the onProgress callback and
 * can hold onto them itself if it needs to survive a `result === undefined`
 * throw.
 */
async function streamStudyBody<T>(
  payload: Record<string, unknown>,
  doneKey: string,
  onProgress?: OnGenerationProgress,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STUDYBODY_TIMEOUT_MS);

  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    if (!token) throw new Error("Sign in again before using My Coach.");

    const resp = await expoFetch(STUDYBODY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      body: JSON.stringify({ ...payload, stream: true }),
    });

    if (!resp.ok) {
      let message = "My Coach AI request failed";
      try {
        const j = await resp.json();
        message = j.error ?? message;
      } catch {
        /* ignore */
      }
      throw new Error(message);
    }

    const body = resp.body;
    if (!body) {
      // No streaming body available on this runtime - fall back to a single
      // buffered read and parse every line out of the whole payload at once.
      // Slower to show progress, but not slower to finish: the server has
      // already done the same work either way.
      const text = await resp.text();
      const outcome = { result: undefined as T | undefined, error: null as string | null };
      for (const line of text.split("\n")) applyStudyBodySseLine(line, doneKey, onProgress, outcome);
      if (outcome.error) throw new Error(outcome.error);
      if (outcome.result === undefined) {
        throw new Error("The AI stream ended before it finished. Please try again.");
      }
      return outcome.result;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const outcome = { result: undefined as T | undefined, error: null as string | null };
    let sawDone = false;

    while (!sawDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (applyStudyBodySseLine(line, doneKey, onProgress, outcome)) sawDone = true;
      }
    }
    if (buffer.trim()) applyStudyBodySseLine(buffer, doneKey, onProgress, outcome);

    if (outcome.error) throw new Error(outcome.error);
    if (outcome.result === undefined) {
      throw new Error("The AI stream ended before it finished. Please try again.");
    }
    return outcome.result;
  } finally {
    clearTimeout(timeout);
  }
}

/** Parses one SSE line, mutating `outcome` in place. Returns true once the
 * `[DONE]` sentinel is seen, so the caller knows to stop reading. */
function applyStudyBodySseLine<T>(
  line: string,
  doneKey: string,
  onProgress: OnGenerationProgress | undefined,
  outcome: { result: T | undefined; error: string | null },
): boolean {
  let l = line;
  if (l.endsWith("\r")) l = l.slice(0, -1);
  if (!l || l.startsWith(":") || !l.startsWith("data: ")) return false;
  const json = l.slice(6).trim();
  if (json === "[DONE]") return true;
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.event === "batch") {
      onProgress?.({
        made: typeof parsed.made === "number" ? parsed.made : 0,
        target: typeof parsed.target === "number" ? parsed.target : 0,
      });
    } else if (parsed.event === "done") {
      outcome.result = parsed[doneKey] as T;
    } else if (parsed.event === "error") {
      outcome.error = typeof parsed.error === "string" ? parsed.error : "My Coach AI request failed";
    }
  } catch {
    /* ignore malformed keep-alive fragments */
  }
  return false;
}

export async function generateStudyPlan({
  profile,
  planTitle,
  courseOutline,
  documents,
}: {
  profile: Profile;
  planTitle: string;
  courseOutline: string;
  documents: StudyDocument[];
}) {
  return callStudyBody<{
    title: string;
    course_outline: string;
    source_type: "uploaded" | "generated" | "mixed";
    topics: StudyRoadmapTopic[];
  }>({
    action: "generate_plan",
    profile,
    planTitle,
    courseOutline,
    documents,
  });
}

export async function generateStudyQuestions({
  profile,
  topic,
  questionType,
  count,
  mcqCount,
  essayCount,
  documents,
  excludePrompts,
  difficultyHint,
  difficulty,
  onProgress,
}: {
  profile: Profile;
  topic: unknown;
  questionType: StudyQuestionType;
  count: number;
  // For the "mixed" type, the caller specifies how many of each kind to make.
  mcqCount?: number;
  essayCount?: number;
  documents: StudyDocument[];
  excludePrompts?: string[];
  difficultyHint?: "easier" | "medium" | "harder";
  // Explicit student-chosen level; overrides the adaptive difficultyHint.
  difficulty?: "easy" | "medium" | "hard";
  // Optional: how many questions exist so far, out of how many were asked
  // for, fired once per completed AI batch. Always streams under the hood
  // now (see streamStudyBody) for the reliability win even if the caller
  // does not pass this - Battle Royale wires it into its progress bar; My
  // Coach gets the streaming reliability for free without wiring it up.
  onProgress?: OnGenerationProgress;
}) {
  const questions = await streamStudyBody<GeneratedQuestion[]>(
    {
      action: "generate_questions",
      profile,
      topic,
      questionType,
      count,
      mcqCount,
      essayCount,
      documents,
      excludePrompts,
      difficultyHint,
      difficulty,
    },
    "questions",
    onProgress,
  );
  return { questions };
}

export async function generateFlashcards({
  profile,
  topic,
  count,
  documents,
  excludeFronts,
  onProgress,
}: {
  profile: Profile;
  topic: unknown;
  count: number;
  documents: StudyDocument[];
  excludeFronts?: string[];
  onProgress?: OnGenerationProgress;
}) {
  const flashcards = await streamStudyBody<GeneratedFlashcard[]>(
    {
      action: "generate_flashcards",
      profile,
      topic,
      count,
      documents,
      excludePrompts: excludeFronts,
    },
    "flashcards",
    onProgress,
  );
  return { flashcards };
}

export async function reviewStudyAnswers({
  profile,
  mode,
  questions,
  answers,
}: {
  profile: Profile;
  mode: "Simplified" | "Detailed" | "Storytelling";
  questions: unknown[];
  answers: Record<string, string>;
}) {
  return callStudyBody<StudyReview>({
    action: "review_answers",
    profile,
    mode,
    questions,
    answers,
  });
}
