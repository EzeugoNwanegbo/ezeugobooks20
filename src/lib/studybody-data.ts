// Shared data access for the My Coach experience. Both the My Coach page
// (roadmap building + history) and the Practice page reuse these Supabase
// helpers and row types, so the query logic lives in one place.
import { supabase } from "@/integrations/supabase/client";
import { DEDUP_SCHEMA_APPLIED } from "@/lib/content-hash";
import { embedQuery } from "@/lib/embeddings";
import { generateStudyQuestions } from "@/lib/studybody-client";
import type { Profile } from "@/lib/auth-context";
import type { StudyDocument, StudyQuestionType } from "@/lib/studybody-client";

type AnyDb = {
  from: (table: string) => DbQuery;
  rpc: (fn: string, args: Record<string, unknown>) => DbQuery;
};

type DbResult = {
  data: unknown;
  error: { code?: string; message: string } | null;
};

type DbQuery = PromiseLike<DbResult> & {
  select: (columns?: string) => DbQuery;
  eq: (column: string, value: unknown) => DbQuery;
  in: (column: string, values: unknown[]) => DbQuery;
  order: (column: string, options?: { ascending?: boolean }) => DbQuery;
  insert: (values: unknown) => DbQuery;
  update: (values: unknown) => DbQuery;
  upsert: (values: unknown) => DbQuery;
  single: () => Promise<DbResult>;
};

export const db = supabase as unknown as AnyDb;

export type DocRow = {
  id: string;
  file_name: string;
  extracted_text: string | null;
  folder_id: string | null;
  folders?: { name: string | null } | { name: string | null }[] | null;
};

export type PlanRow = {
  id: string;
  title: string;
  course_outline: string | null;
  source_type: string;
  source_document_ids: string[] | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

export type TopicRow = {
  id: string;
  plan_id: string;
  title: string;
  summary: string | null;
  objectives: string[] | null;
  source_refs: unknown[] | null;
  position: number;
  status: "not_started" | "learning" | "practicing" | "mastered";
  mastery_score: number;
  last_practiced_at: string | null;
};

export type SessionRow = {
  id: string;
  plan_id: string;
  topic_id: string;
  question_type: StudyQuestionType;
  score: number | null;
  /** How many were asked for. The generator may return fewer. */
  requested_count: number;
  total_questions: number;
  status: "in_progress" | "completed";
  feedback: Record<string, unknown> | null;
};

export type QuestionRow = {
  id: string;
  session_id: string;
  question_type: "mcq" | "essay" | "flashcard";
  prompt: string;
  options: { id: string; text: string }[] | null;
  correct_answer: string;
  explanation: string | null;
  rubric: string[] | null;
  source_refs: unknown[] | null;
  difficulty: string;
  position: number;
};

export type ChunkRow = {
  document_id: string;
  file_name: string;
  folder: string | null;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
};

export const STATUS_LABEL: Record<TopicRow["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  practicing: "Practicing",
  mastered: "Mastered",
};

// A topic is only "mastered" after two recent practice sets both clear this
// bar - one lucky set will not flip the roadmap to done.
export const MASTERY_THRESHOLD = 80;
export const MASTERY_HISTORY = 3;

// Char budget for whole-document roadmap sampling, kept under the edge
// function's 100k total so the request stays within DeepSeek's context.
const MAX_SPAN_CHARS_TOTAL = 90_000;

export function folderName(row: DocRow): string | null {
  if (Array.isArray(row.folders)) return row.folders[0]?.name ?? null;
  return row.folders?.name ?? null;
}

export function termsFrom(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 10);
}

export function sourceText(sourceRefs: unknown[] | null | undefined): string {
  if (!Array.isArray(sourceRefs) || sourceRefs.length === 0) return "from your uploaded material";
  return sourceRefs
    .slice(0, 2)
    .map((ref) => {
      if (!ref || typeof ref !== "object") return "Source";
      const item = ref as Record<string, unknown>;
      return [item.file, item.page].filter(Boolean).join(" - ") || "Source";
    })
    .join(", ");
}

export function difficultyFromScore(score?: number | null): "easier" | "medium" | "harder" {
  if (score == null) return "medium";
  if (score >= MASTERY_THRESHOLD) return "harder";
  if (score <= 50) return "easier";
  return "medium";
}

// Sustained mastery: blend the most recent completed sessions instead of letting
// a single set define the topic, and only mark "mastered" after two recent sets
// both clear the bar. Returns whether the topic is now mastered.
export async function finalizeTopicMastery(topicId: string, percentage: number): Promise<boolean> {
  const { data: recentRows } = await db
    .from("study_sessions")
    .select("score, status, created_at")
    .eq("topic_id", topicId)
    .eq("status", "completed")
    .order("created_at", { ascending: false });
  const recentScores = ((recentRows as { score: number | null }[]) ?? []).map((row) =>
    Math.round(Number(row.score ?? 0)),
  );
  if (!recentScores.length) recentScores.push(percentage);
  const recentWindow = recentScores.slice(0, MASTERY_HISTORY);
  const rollingAvg = Math.round(
    recentWindow.reduce((sum, value) => sum + value, 0) / recentWindow.length,
  );
  const mastered =
    recentWindow.length >= 2 &&
    recentWindow[0] >= MASTERY_THRESHOLD &&
    recentWindow[1] >= MASTERY_THRESHOLD;
  const nextStatus: TopicRow["status"] = mastered
    ? "mastered"
    : rollingAvg > 0
      ? "practicing"
      : "learning";
  await db
    .from("study_topics")
    .update({
      mastery_score: rollingAvg,
      status: nextStatus,
      last_practiced_at: new Date().toISOString(),
    })
    .eq("id", topicId);
  return mastered;
}

// ── "Go straight in" ────────────────────────────────────────────────────────
// The second way into My Coach: no roadmap, no AI planning call, no ordered
// topics — just questions from the whole of the selected material, now.
//
// What makes it *broad* rather than a linear progression is the retrieval, not
// the prompt. The roadmap flow narrows to one topic and pulls the chunks that
// match that topic's title (loadStudyDocuments with a query). This flow uses
// loadStudyDocumentsSpanning, which samples evenly from the start, middle and
// end of every selected file, so a 400-page textbook produces questions from
// chapter 1 and chapter 19 in the same set.
//
// It stores itself as an ordinary plan with exactly one topic, which is why it
// needs no schema change and why the practice screen, the resume flow, the
// mastery maths and the points all work on it unmodified.

/** The share of a straight-in set given to written answers, the rest MCQ. */
const STRAIGHT_IN_ESSAY_SHARE = 0.2;

export function straightInSplit(count: number): { mcq: number; essay: number } {
  const total = Math.max(1, Math.round(count));
  if (total < 5) return { mcq: total, essay: 0 };
  const essay = Math.max(1, Math.round(total * STRAIGHT_IN_ESSAY_SHARE));
  return { mcq: total - essay, essay };
}

/**
 * The styles "Go straight in" can build. Not the whole StudyQuestionType union:
 * "flashcard" is deliberately absent — see the note on `questionType` below.
 */
export type StraightInType = Extract<StudyQuestionType, "mcq" | "essay" | "mixed">;

export const STRAIGHT_IN_TYPES: readonly StraightInType[] = ["mcq", "essay", "mixed"] as const;

/** The steps the caller can show a progress line for. Each is one awaited call. */
export type StraightInStage = "reading" | "writing" | "saving";

/**
 * The style this student last finished a set in, if we know one.
 *
 * `study_preferences.preferred_question_type` is already written after every
 * completed set (see the two upserts on the practice page) but has never been
 * read back anywhere — so the app has been recording a preference and then
 * ignoring it. This reads it, and it is the only per-student question-style
 * signal that exists: `profile.preferred_mode` is the explanation style
 * (Simplified / Detailed), not a question type.
 *
 * Returns null on anything unexpected — a missing row for a new student, a
 * "flashcard" value from the roadmap screen, or an error — and the caller keeps
 * its own default. Never throws: a default is not worth failing a page load for.
 */
export async function loadPreferredStraightInType(userId: string): Promise<StraightInType | null> {
  try {
    const { data, error } = await db
      .from("study_preferences")
      .select("preferred_question_type")
      .eq("user_id", userId);
    if (error) return null;
    const rows = (data as { preferred_question_type?: unknown }[] | null) ?? [];
    const value = rows[0]?.preferred_question_type;
    return STRAIGHT_IN_TYPES.find((type) => type === value) ?? null;
  } catch {
    return null;
  }
}

export async function createStraightInSession({
  userId,
  profile,
  title,
  documentIds,
  docsMeta,
  count,
  questionType = "mixed",
  difficulty,
  timerSeconds,
  onStage,
}: {
  userId: string;
  profile: Profile;
  title: string;
  documentIds: string[];
  docsMeta: DocRow[];
  count: number;
  /**
   * The style the student picked. Defaults to "mixed", which is what this flow
   * always built before the choice existed, so an older caller is unchanged.
   *
   * "flashcard" is not offered: the edge function's generate_questions action
   * only knows mcq / essay / mixed and silently falls back to MCQ for anything
   * else, and cards come from a different action (generate_flashcards) with a
   * different row shape. Adding it here would mean a second generation path
   * inside this function, not a value passed down the existing one.
   */
  questionType?: StraightInType;
  difficulty: "easy" | "medium" | "hard";
  /** Omitted or 0 for an untimed set — no timer key is written at all. */
  timerSeconds?: number;
  /** Called as each real step begins, so the caller can show honest progress. */
  onStage?: (stage: StraightInStage) => void;
}): Promise<{ planId: string; sessionId: string }> {
  onStage?.("reading");
  const documents = await loadStudyDocumentsSpanning(documentIds, docsMeta);

  // Only "mixed" splits the set two ways; the single-style sets ask for one kind
  // and let the edge function's non-mixed branch handle the whole count.
  const requested = Math.max(1, Math.round(count));
  const split =
    questionType === "mixed"
      ? straightInSplit(requested)
      : questionType === "essay"
        ? { mcq: 0, essay: requested }
        : { mcq: requested, essay: 0 };

  const topicStub = {
    title,
    summary: "A broad set drawn from across the whole of the selected material.",
    objectives: [],
    source_refs: [],
  };
  onStage?.("writing");
  const generated = await generateStudyQuestions({
    profile,
    topic: topicStub,
    questionType,
    count: split.mcq + split.essay,
    mcqCount: questionType === "mixed" ? split.mcq : undefined,
    essayCount: questionType === "mixed" ? split.essay : undefined,
    documents,
    difficulty,
  });
  if (!generated.questions.length) {
    throw new Error("No questions could be built from this material. Try another file.");
  }

  onStage?.("saving");
  const { data: planData, error: planErr } = await db
    .from("study_plans")
    .insert({
      user_id: userId,
      title,
      course_outline: "",
      source_type: "uploaded",
      source_document_ids: documentIds,
      preference_snapshot: { straight_in: true },
    })
    .select("id")
    .single();
  if (planErr) throw planErr;
  const planId = (planData as { id: string }).id;

  const { data: topicData, error: topicErr } = await db
    .from("study_topics")
    .insert({
      user_id: userId,
      plan_id: planId,
      title,
      summary: topicStub.summary,
      objectives: [],
      source_refs: [],
      position: 0,
      status: "practicing",
    })
    .select("id")
    .single();
  if (topicErr) throw topicErr;
  const topicId = (topicData as { id: string }).id;

  const { data: sessionData, error: sessionErr } = await db
    .from("study_sessions")
    .insert({
      user_id: userId,
      plan_id: planId,
      topic_id: topicId,
      question_type: questionType,
      requested_count: split.mcq + split.essay,
      total_questions: generated.questions.length,
      feedback: {
        mode: "learning",
        straight_in: true,
        ...(timerSeconds && timerSeconds > 0 ? { timer_seconds: timerSeconds } : {}),
      },
    })
    .select("id")
    .single();
  if (sessionErr) throw sessionErr;
  const sessionId = (sessionData as { id: string }).id;

  const questionRows = generated.questions.map((question, index) => {
    const normalizedType: "mcq" | "essay" = question.type === "essay" ? "essay" : "mcq";
    return {
      user_id: userId,
      session_id: sessionId,
      plan_id: planId,
      topic_id: topicId,
      question_type: normalizedType,
      prompt: question.prompt,
      options: normalizedType === "mcq" ? (question.options ?? []) : [],
      correct_answer: question.correct_answer,
      explanation: question.explanation ?? "",
      rubric: question.rubric ?? [],
      difficulty: question.difficulty ?? difficulty,
      source_refs: question.source_refs ?? [],
      position: index,
    };
  });
  const { error: questionErr } = await db.from("study_questions").insert(questionRows);
  if (questionErr) throw questionErr;

  return { planId, sessionId };
}

// Pick items spread evenly across the list (always including the first and
// last) until the character budget is reached, so the sample represents the
// whole document instead of just the opening chunks.
function sampleEvenly(items: string[], maxChars: number): string {
  if (items.length === 0) return "";
  const total = items.reduce((sum, item) => sum + item.length, 0);
  if (total <= maxChars) return items.join("\n\n");

  const avg = total / items.length;
  const canFit = Math.max(1, Math.floor(maxChars / Math.max(avg, 1)));
  if (canFit >= items.length) return items.join("\n\n");

  const indices: number[] = [];
  for (let k = 0; k < canFit; k += 1) {
    const idx = canFit === 1 ? 0 : Math.round((k * (items.length - 1)) / (canFit - 1));
    if (indices[indices.length - 1] !== idx) indices.push(idx);
  }

  return indices
    .map((idx, order) => {
      const gap = order > 0 && idx - indices[order - 1] > 1 ? "[...]\n" : "";
      return `${gap}${items[idx]}`;
    })
    .join("\n\n");
}

export async function loadStudyDocuments(
  documentIds: string[],
  query?: string,
): Promise<StudyDocument[]> {
  if (!documentIds.length) return [];

  if (query) {
    const queryEmbedding = await embedQuery(query);
    const { data } = await db.rpc("search_document_chunks_hybrid", {
      query_terms: termsFrom(query),
      query_embedding: queryEmbedding,
      match_document_ids: documentIds,
      match_count: 24,
    });
    const chunks = (data as ChunkRow[]) ?? [];
    if (chunks.length) {
      const grouped = new Map<string, StudyDocument>();
      for (const chunk of chunks) {
        // Pages only — a chunk index is an internal splitting artefact and is
        // useless for finding the passage in the actual book.
        const label =
          chunk.page_start || chunk.page_end
            ? `[Page ${chunk.page_start ?? "?"}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ""}]`
            : "";
        const existing = grouped.get(chunk.document_id);
        const text = label ? `${label}\n${chunk.content}` : chunk.content;
        if (existing) {
          existing.excerpt = `${existing.excerpt}\n\n${text}`.slice(0, 24000);
        } else {
          grouped.set(chunk.document_id, {
            id: chunk.document_id,
            file_name: chunk.file_name,
            folder: chunk.folder,
            excerpt: text,
          });
        }
      }
      return [...grouped.values()];
    }
  }

  const { data, error } = await db
    .from("documents")
    .select("id, file_name, extracted_text, folder_id, folders(name)")
    .in("id", documentIds);
  if (error) throw error;
  return ((data as DocRow[]) ?? []).map((doc) => ({
    id: doc.id,
    file_name: doc.file_name,
    folder: folderName(doc),
    excerpt: (doc.extracted_text || "").slice(0, 18000),
  }));
}

// For roadmap building we need coverage of the WHOLE document, not just the
// first few pages. Pull the stored chunks and sample evenly across each file
// (start → middle → end) so DeepSeek plans from the entire textbook.
export async function loadStudyDocumentsSpanning(
  documentIds: string[],
  docsMeta: DocRow[],
): Promise<StudyDocument[]> {
  if (!documentIds.length) return [];

  // document_chunks_effective, not document_chunks: when several students upload
  // the same textbook only one copy of its chunks is stored, and the other
  // students' documents rows link to it (documents.canonical_document_id). The
  // view resolves that link and still reports the CALLER'S document id, so the
  // filter and the per-document grouping below are unchanged. Reading the raw
  // table here would return zero rows for anyone holding a linked copy.
  //
  // Gated: the view is created by the dedup migration, which is applied by hand.
  // Until then there are no linked copies to resolve, so the raw table is exactly
  // equivalent - and querying a view that does not exist returns nothing at all.
  const { data, error } = await db
    .from(DEDUP_SCHEMA_APPLIED ? "document_chunks_effective" : "document_chunks")
    .select("document_id, chunk_index, page_start, page_end, content")
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true });

  const rows =
    (data as Pick<
      ChunkRow,
      "document_id" | "chunk_index" | "page_start" | "page_end" | "content"
    >[]) ?? [];
  // No chunk rows (older uploads) - fall back to head-of-text excerpts.
  if (error || rows.length === 0) return loadStudyDocuments(documentIds);

  const byDoc = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byDoc.get(row.document_id) ?? [];
    list.push(row);
    byDoc.set(row.document_id, list);
  }

  const docMeta = new Map(docsMeta.map((doc) => [doc.id, doc]));
  const perDocBudget = Math.max(8000, Math.floor(MAX_SPAN_CHARS_TOTAL / documentIds.length));

  const result: StudyDocument[] = [];
  for (const [docId, chunks] of byDoc) {
    const labelled = chunks.map((chunk) => {
      // Pages only, same reasoning as above.
      const label =
        chunk.page_start || chunk.page_end
          ? `[Page ${chunk.page_start ?? "?"}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ""}]`
          : "";
      return label ? `${label}\n${chunk.content}` : chunk.content;
    });
    const meta = docMeta.get(docId);
    result.push({
      id: docId,
      file_name: meta?.file_name ?? "Document",
      folder: meta ? folderName(meta) : null,
      excerpt: sampleEvenly(labelled, perDocBudget),
    });
  }
  return result;
}
