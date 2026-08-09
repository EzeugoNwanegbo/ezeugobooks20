// Server-side MCQ grading: the one place the withheld-key schema is named.
//
// ── OFF UNTIL THE MIGRATION IS APPLIED ──────────────────────────────────────
// Everything below depends on two functions that do not exist in production
// yet - public.study_session_questions() and public.study_mcq_grade(), created
// by supabase/migrations/20260810120000_mcq_server_grading.sql, which the owner
// applies by hand.
//
// Naming a function that does not exist makes PostgREST reject the whole call,
// so every reference is behind this flag. With it false this module makes no
// network call of any kind: the caller is told to use the path it has always
// used, and nothing is asked of the server.
//
// Flip it to true in the SAME commit that applies the migration. Not before,
// and not in a separate deploy.
export const MCQ_GRADING_APPLIED = true;

import { db, type QuestionRow } from "@/lib/studybody-data";

/**
 * What the server hands back for one graded MCQ.
 *
 * `is_correct` is decided in SQL by comparing the submitted answer against
 * study_questions.correct_answer. Nothing the browser computes is sent up and
 * nothing it computes is trusted; this is the value that was also written to
 * study_answers.
 */
export type McqGrade = {
  question_id: string;
  is_correct: boolean;
  /** The key, released now that the answer is in. */
  correct_answer: string;
  /** Released with the key, for the same reason: it gives the answer away. */
  explanation: string | null;
};

/**
 * A question as the practice screen may see it.
 *
 * Identical to QuestionRow, plus `answered`. For an MCQ the caller has not yet
 * submitted an answer to, `correct_answer` is "" and `explanation` is null - the
 * server never sends the key for a question that has not been earned.
 *
 * Withheld is "" rather than null so QuestionRow's `correct_answer: string`
 * stays true and no shared type has to change. Branch on `answered`, never on
 * the emptiness of the string.
 */
export type PracticeQuestion = QuestionRow & { answered: boolean };

type RpcRow = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toQuestion(row: RpcRow): PracticeQuestion {
  return {
    id: str(row.id),
    session_id: str(row.session_id),
    question_type: (row.question_type as QuestionRow["question_type"]) ?? "mcq",
    prompt: str(row.prompt),
    options: (row.options as QuestionRow["options"]) ?? [],
    correct_answer: str(row.correct_answer),
    explanation: typeof row.explanation === "string" ? row.explanation : null,
    rubric: (row.rubric as string[] | null) ?? [],
    source_refs: (row.source_refs as unknown[] | null) ?? [],
    difficulty: str(row.difficulty) || "medium",
    position: typeof row.position === "number" ? row.position : 0,
    answered: row.answered === true,
  };
}

/**
 * Load a session's questions with unearned MCQ keys withheld.
 *
 * Returns null when the flag is off, which means "use the ordinary table read"
 * rather than "there are no questions" - a caller that treated null as an empty
 * set would render an empty practice screen in production today.
 */
export async function loadQuestionsWithheld(sessionId: string): Promise<PracticeQuestion[] | null> {
  if (!MCQ_GRADING_APPLIED) return null;
  const { data, error } = await db.rpc("study_session_questions", { p_session_id: sessionId });
  if (error) throw new Error(error.message);
  return ((data as RpcRow[] | null) ?? []).map(toQuestion);
}

/**
 * Grade submitted MCQ answers on the server and get the keys back.
 *
 * `answers` is {questionId: optionId}. Send one entry for Learning mode (the
 * question just answered) or the whole set for Exam mode. Entries that are not
 * MCQs of this session are ignored by the server, so a mixed set can send its
 * whole answer map without the caller filtering it first.
 *
 * Returns null when the flag is off - again "grade it the old way", not "no
 * questions were graded".
 */
export async function gradeMcqOnServer(
  sessionId: string,
  answers: Record<string, string>,
): Promise<McqGrade[] | null> {
  if (!MCQ_GRADING_APPLIED) return null;
  const payload: Record<string, string> = {};
  for (const [questionId, answer] of Object.entries(answers)) {
    if (typeof answer === "string" && answer.trim()) payload[questionId] = answer;
  }
  if (Object.keys(payload).length === 0) return [];
  const { data, error } = await db.rpc("study_mcq_grade", {
    p_session_id: sessionId,
    p_answers: payload,
  });
  if (error) throw new Error(error.message);
  return ((data as RpcRow[] | null) ?? []).map((row) => ({
    question_id: str(row.question_id),
    is_correct: row.is_correct === true,
    correct_answer: str(row.correct_answer),
    explanation: typeof row.explanation === "string" ? row.explanation : null,
  }));
}
