// G&D — My Coach (StudyBody) shared data layer for the native app.
//
// Mirrors src/lib/studybody-data.ts on the web: Supabase types, grounded
// document retrieval (hybrid embedding + keyword search over document_chunks),
// whole-document sampling for roadmap building, and the sustained-mastery rule.
// The screen (coach.tsx) stays lean by leaning on these helpers.

import { supabase } from "./supabase";
import { embedQuery } from "./embeddings";
import type { StudyDocument, StudyQuestionType, StudyReview } from "./studybody-client";

// The supabase-js types don't model our RPCs/tables, so we cast to a loose
// query surface. This matches the pattern used elsewhere in the native app.
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

// Per-question draft answer + (for Learning mode) on-device MCQ grade, kept in
// study_sessions.feedback so a half-finished set resumes exactly in place.
export type SessionDraft = {
  mode?: PracticeMode;
  questionType?: StudyQuestionType;
  difficulty?: DifficultyLevel;
  draftAnswers?: Record<string, string>;
  revealed?: string[];
};

export type SessionRow = {
  id: string;
  plan_id: string;
  topic_id: string;
  question_type: StudyQuestionType;
  score: number | null;
  total_questions: number;
  status: "in_progress" | "completed";
  feedback:
    | (SessionDraft & { grading?: StudyReview["grading"]; coaching?: string })
    | null;
};

export type QuestionRow = {
  id: string;
  session_id: string;
  question_type: "mcq" | "essay";
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

export type PracticeMode = "learning" | "exam";
export type DifficultyLevel = "easy" | "medium" | "hard";

// The owner's picks (2026-08-13): 3/5 read as low, so the fast-tap presets
// moved up to 10/20/30. QUESTION_COUNTS keeps its name and `as const` array
// shape — Battle Royale imports it directly — only the values changed.
export const QUESTION_COUNTS = [10, 20, 30] as const;

// Bounds for the free-typed "Custom" count. The floor is the obvious "a set
// needs at least one question".
//
// The ceiling is NOT the edge function's own clamp — that clamp is 100
// (supabase/functions/studybody/index.ts), well above this. 50 is the
// owner's OWN ceiling for this screen, the same number and the same reasoning
// as Battle Royale's BATTLE_MAX_QUESTIONS (see battle-royale-client.ts):
// chosen after a 30-question Battle Royale generation was tried and aborted,
// against the same generator and the same wall-clock budget this app does
// not control (a Supabase Edge Function caps around 150s on the free plan; a
// stalled request degrades gracefully now that generation streams - see
// streamStudyBody in studybody-client.ts - but streaming does not raise that
// ceiling). A permissive server (100) under a restrictive client (50) is the
// safe direction; the two numbers are deliberately not kept equal any more.
export const QUESTION_COUNT_MIN = 1;
export const QUESTION_COUNT_MAX = 50;

/** Parses a typed question count, rejecting anything that isn't a whole
 * number inside [QUESTION_COUNT_MIN, QUESTION_COUNT_MAX]. Returns the
 * validated count or an error string to show under the field — never a
 * silently clamped value, so a student who types "5000" learns why it didn't
 * take instead of unknowingly getting a different number. */
export function parseQuestionCount(raw: string): { ok: true; count: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Type a number of questions." };
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    return { ok: false, error: "Whole numbers only." };
  }
  if (n < QUESTION_COUNT_MIN || n > QUESTION_COUNT_MAX) {
    return { ok: false, error: `Pick ${QUESTION_COUNT_MIN}-${QUESTION_COUNT_MAX}.` };
  }
  return { ok: true, count: n };
}

// ─── Exam-mode timer ────────────────────────────────────────────────────────
//
// Mirrors the web's "Race the clock" vocabulary and math (src/lib/timed-
// challenge.ts) so the two apps don't grow two different timer languages —
// but this app ships separately (see the DEDUP_SCHEMA_APPLIED note below) and
// has no bonus-scoring path yet, so only the duration picking + countdown
// piece is ported, not the speed-bonus accounting.
//
// Used to SUGGEST a duration from the size of the set — never a hard limit.
const DEFAULT_TIMER_SECONDS_PER_QUESTION = 45;

// The ceiling is 4 hours, same reasoning as the web: the largest set this
// screen can request is QUESTION_COUNT_MAX (50), and the most generous
// suggested pace for 50 questions is (50*45/60)*1.5 ≈ 56 minutes — 240
// minutes clears that with a lot of room while still refusing an obvious typo
// (e.g. "2400"). The floor of 1 minute is the shortest span a countdown can
// meaningfully show.
export const MIN_TIMER_MINUTES = 1;
export const MAX_TIMER_MINUTES = 240;

/** Turns what the student typed (in MINUTES) into whole seconds, or an error
 * to show under the field. Deliberately not a silent clamp — same reasoning
 * as parseQuestionCount: a rejected number should say why, not get rounded
 * into a duration the student never chose. */
export function parseTimerMinutes(raw: string): { ok: true; seconds: number } | { ok: false; error: string } {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Type how many minutes you want." };
  const minutes = Number(text);
  if (!Number.isFinite(minutes)) {
    return { ok: false, error: "Minutes only — a number like 25." };
  }
  if (minutes < MIN_TIMER_MINUTES || minutes > MAX_TIMER_MINUTES) {
    return { ok: false, error: `Pick ${MIN_TIMER_MINUTES}-${MAX_TIMER_MINUTES} minutes.` };
  }
  return { ok: true, seconds: Math.round(minutes * 60) };
}

/** The three offered durations for a set of `count` questions: tight, the
 * suggested pace, and generous — in whole minutes, de-duplicated (small sets
 * can collapse all three onto the same minute). */
export function timerPresetMinutes(count: number): number[] {
  const safeCount = Math.max(1, Math.round(count || 1));
  const suggested = Math.max(1, Math.round((safeCount * DEFAULT_TIMER_SECONDS_PER_QUESTION) / 60));
  const presets = [Math.max(1, Math.round(suggested * 0.7)), suggested, Math.round(suggested * 1.5)];
  return [...new Set(presets)];
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

// A topic is only "mastered" after two recent practice sets both clear this
// bar — one lucky set will not flip the roadmap to done.
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

function chunkLabel(chunk: { page_start: number | null; page_end: number | null; chunk_index: number }): string {
  return chunk.page_start || chunk.page_end
    ? `[Page ${chunk.page_start ?? "?"}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ""}]`
    : `[Chunk ${chunk.chunk_index + 1}]`;
}

// Topic-scoped grounded retrieval: hybrid embedding + keyword search over the
// document_chunks, grouped per document. Falls back to head-of-text excerpts
// when there are no chunks (older uploads) or the search returns nothing.
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
        const text = `${chunkLabel(chunk)}\n${chunk.content}`;
        const existing = grouped.get(chunk.document_id);
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

// Pick items spread evenly across the list (always including first and last)
// until the character budget is reached, so the sample represents the whole
// document instead of just the opening chunks.
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

// For roadmap building we need coverage of the WHOLE document, not just the
// first few pages. Pull the stored chunks and sample evenly across each file
// (start → middle → end) so DeepSeek plans from the entire textbook.
export async function loadStudyDocumentsSpanning(
  documentIds: string[],
  docsMeta: DocRow[],
): Promise<StudyDocument[]> {
  if (!documentIds.length) return [];

  // document_chunks_effective, not document_chunks: identical textbooks are
  // stored once in the G&D pool and each student's documents row links to that
  // copy (documents.pooled_document_id). The view resolves the link and still
  // reports the CALLER'S document id, so the filter and grouping are unchanged.
  // Reading the raw table returns nothing for anyone holding a pooled copy.
  //
  // Gated on the same flag as the web app: the view is created by the dedup
  // migration, which is applied by hand. Until it runs there are no pooled
  // copies, so the raw table is equivalent - and a view that does not exist
  // returns nothing at all. Keep this in step with src/lib/content-hash.ts.
  //
  // THIS APP SHIPS SEPARATELY. Flipping the flag on the web does not flip it
  // here, and stage 5 of the migration deletes the private chunk rows this file
  // would otherwise read - so the build students have installed must already be
  // one with this true before that stage runs.
  const DEDUP_SCHEMA_APPLIED = false;
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
    const labelled = chunks.map((chunk) => `${chunkLabel(chunk)}\n${chunk.content}`);
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
