// Shared data access for the My Coach experience. Both the My Coach page
// (roadmap building + history) and the Practice page reuse these Supabase
// helpers and row types, so the query logic lives in one place.
import { supabase } from "@/integrations/supabase/client";
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
    const { data } = await db.rpc("search_document_chunks", {
      query_terms: termsFrom(query),
      match_document_ids: documentIds,
      match_count: 18,
    });
    const chunks = (data as ChunkRow[]) ?? [];
    if (chunks.length) {
      const grouped = new Map<string, StudyDocument>();
      for (const chunk of chunks) {
        const label =
          chunk.page_start || chunk.page_end
            ? `[Page ${chunk.page_start ?? "?"}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ""}]`
            : `[Chunk ${chunk.chunk_index + 1}]`;
        const existing = grouped.get(chunk.document_id);
        const text = `${label}\n${chunk.content}`;
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

  const { data, error } = await db
    .from("document_chunks")
    .select("document_id, chunk_index, page_start, page_end, content")
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true });

  const rows =
    (data as Pick<
      ChunkRow,
      "document_id" | "chunk_index" | "page_start" | "page_end" | "content"
    >[]) ?? [];
  // No chunk rows (older uploads) — fall back to head-of-text excerpts.
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
      const label =
        chunk.page_start || chunk.page_end
          ? `[Page ${chunk.page_start ?? "?"}${chunk.page_end && chunk.page_end !== chunk.page_start ? `-${chunk.page_end}` : ""}]`
          : `[Chunk ${chunk.chunk_index + 1}]`;
      return `${label}\n${chunk.content}`;
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
