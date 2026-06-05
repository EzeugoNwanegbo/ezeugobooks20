import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  FileText,
  Loader2,
  Map as MapIcon,
  Play,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  generateStudyPlan,
  generateStudyQuestions,
  reviewStudyAnswers,
  type GeneratedQuestion,
  type StudyDocument,
  type StudyQuestionType,
  type StudyReview,
  type StudyRoadmapTopic,
} from "@/lib/studybody-client";

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

type DocRow = {
  id: string;
  file_name: string;
  extracted_text: string | null;
  folder_id: string | null;
  folders?: { name: string | null } | { name: string | null }[] | null;
};

type PlanRow = {
  id: string;
  title: string;
  course_outline: string | null;
  source_type: string;
  source_document_ids: string[] | null;
  status: string;
  created_at: string | null;
  updated_at: string | null;
};

type TopicRow = {
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

type SessionRow = {
  id: string;
  plan_id: string;
  topic_id: string;
  question_type: StudyQuestionType;
  score: number | null;
  total_questions: number;
  status: "in_progress" | "completed";
  feedback: { grading?: StudyReview["grading"]; coaching?: string } | null;
};

type QuestionRow = {
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

type ChunkRow = {
  document_id: string;
  file_name: string;
  folder: string | null;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  content: string;
};

const db = supabase as unknown as AnyDb;

const QUESTION_COUNTS = [3, 5, 10];
const STATUS_LABEL: Record<TopicRow["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  practicing: "Practicing",
  mastered: "Mastered",
};

function folderName(row: DocRow): string | null {
  if (Array.isArray(row.folders)) return row.folders[0]?.name ?? null;
  return row.folders?.name ?? null;
}

function termsFrom(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2)
    .slice(0, 10);
}

function sourceText(sourceRefs: unknown[] | null | undefined): string {
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

// A topic is only "mastered" after two recent practice sets both clear this
// bar — one lucky set will not flip the roadmap to done.
const MASTERY_THRESHOLD = 80;
const MASTERY_HISTORY = 3;

function difficultyFromScore(score?: number | null): "easier" | "medium" | "harder" {
  if (score == null) return "medium";
  if (score >= MASTERY_THRESHOLD) return "harder";
  if (score <= 50) return "easier";
  return "medium";
}

// Char budget for whole-document roadmap sampling, kept under the edge
// function's 100k total so the request stays within DeepSeek's context.
const MAX_SPAN_CHARS_TOTAL = 90_000;

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

export function StudyBodyPage() {
  const { user, profile } = useAuth();
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [courseOutline, setCourseOutline] = useState("");
  const [questionType, setQuestionType] = useState<StudyQuestionType>("mcq");
  const [questionCount, setQuestionCount] = useState(5);
  const [loading, setLoading] = useState(false);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [review, setReview] = useState<StudyReview | null>(null);
  // Prompts already served per topic, so the adaptive loop keeps asking fresh
  // questions instead of repeating itself as the student practices.
  const askedByTopicRef = useRef<Record<string, string[]>>({});

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );
  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) ?? null,
    [topics, selectedTopicId],
  );
  const averageMastery = useMemo(() => {
    if (!topics.length) return 0;
    return Math.round(
      topics.reduce((sum, topic) => sum + Number(topic.mastery_score || 0), 0) / topics.length,
    );
  }, [topics]);
  const masteredCount = useMemo(
    () => topics.filter((topic) => topic.status === "mastered").length,
    [topics],
  );

  const refreshDocsAndPlans = async () => {
    if (!user) return;
    const [{ data: docRows, error: docErr }, { data: planRows, error: planErr }] =
      await Promise.all([
        db
          .from("documents")
          .select("id, file_name, extracted_text, folder_id, folders(name)")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false }),
        db
          .from("study_plans")
          .select(
            "id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at",
          )
          .eq("user_id", user.id)
          .eq("status", "active")
          .order("updated_at", { ascending: false }),
      ]);

    if (docErr) toast.error(docErr.message);
    if (planErr) {
      if (planErr.code === "PGRST205" || planErr.message.includes("study_plans")) {
        setSchemaMissing(true);
      } else {
        toast.error(planErr.message);
      }
    } else {
      setSchemaMissing(false);
    }

    setDocs((docRows as DocRow[]) ?? []);
    const nextPlans = (planRows as PlanRow[]) ?? [];
    setPlans(nextPlans);
    setSelectedPlanId((current) => current || nextPlans[0]?.id || "");
  };

  const refreshTopics = async (planId = selectedPlanId) => {
    if (!user || !planId) {
      setTopics([]);
      return;
    }
    const { data, error } = await db
      .from("study_topics")
      .select(
        "id, plan_id, title, summary, objectives, source_refs, position, status, mastery_score, last_practiced_at",
      )
      .eq("user_id", user.id)
      .eq("plan_id", planId)
      .order("position", { ascending: true });
    if (error) {
      if (error.code === "PGRST205" || error.message.includes("study_topics")) {
        setSchemaMissing(true);
      }
      toast.error(error.message);
      return;
    }
    const nextTopics = (data as TopicRow[]) ?? [];
    setTopics(nextTopics);
    setSelectedTopicId((current) =>
      current && nextTopics.some((topic) => topic.id === current)
        ? current
        : nextTopics[0]?.id || "",
    );
  };

  useEffect(() => {
    refreshDocsAndPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    refreshTopics(selectedPlanId);
    setActiveSession(null);
    setQuestions([]);
    setAnswers({});
    setReview(null);
    askedByTopicRef.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId]);

  const toggleDoc = (id: string) => {
    setSelectedDocIds((current) =>
      current.includes(id) ? current.filter((docId) => docId !== id) : [...current, id],
    );
  };

  const loadStudyDocuments = async (
    documentIds: string[],
    query?: string,
  ): Promise<StudyDocument[]> => {
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
  };

  // For roadmap building we need coverage of the WHOLE document, not just the
  // first few pages. Pull the stored chunks and sample evenly across each file
  // (start → middle → end) so DeepSeek plans from the entire textbook.
  const loadStudyDocumentsSpanning = async (documentIds: string[]): Promise<StudyDocument[]> => {
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

    const docMeta = new Map(docs.map((doc) => [doc.id, doc]));
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
  };

  const createPlan = async () => {
    if (!user || !profile) return;
    if (schemaMissing) {
      toast.error("StudyBody tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    if (!selectedDocIds.length && !courseOutline.trim()) {
      toast.error("Pick files or paste a course outline first.");
      return;
    }

    setLoading(true);
    try {
      const studyDocs = await loadStudyDocumentsSpanning(selectedDocIds);
      const generated = await generateStudyPlan({
        profile,
        planTitle: planTitle.trim() || "StudyBody roadmap",
        courseOutline,
        documents: studyDocs,
      });

      const { data: planData, error: planErr } = await db
        .from("study_plans")
        .insert({
          user_id: user.id,
          title: generated.title,
          course_outline: generated.course_outline,
          source_type: generated.source_type,
          source_document_ids: selectedDocIds,
          preference_snapshot: {
            exam_format: profile.exam_format,
            preferred_mode: profile.preferred_mode,
            weak_areas: profile.weak_areas ?? [],
          },
        })
        .select(
          "id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at",
        )
        .single();
      if (planErr) throw planErr;
      const plan = planData as PlanRow;

      const topicRows = generated.topics.map((topic: StudyRoadmapTopic, index: number) => ({
        user_id: user.id,
        plan_id: plan.id,
        title: topic.title,
        summary: topic.summary ?? "",
        objectives: topic.objectives ?? [],
        source_refs: topic.source_refs ?? [],
        position: index,
        status: index === 0 ? "learning" : "not_started",
      }));

      if (topicRows.length) {
        const { error: topicErr } = await db.from("study_topics").insert(topicRows);
        if (topicErr) throw topicErr;
      }

      setPlans((current) => [plan as PlanRow, ...current]);
      setSelectedPlanId(plan.id);
      setPlanTitle("");
      setCourseOutline("");
      toast.success("StudyBody roadmap created");
      await refreshTopics(plan.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create roadmap");
    } finally {
      setLoading(false);
    }
  };

  const runPractice = async (
    topic: TopicRow | null,
    opts?: { continuing?: boolean; lastScore?: number | null },
  ) => {
    if (!user || !profile || !activePlan || !topic) return;
    if (schemaMissing) {
      toast.error("StudyBody tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    const ids = activePlan.source_document_ids?.length
      ? activePlan.source_document_ids
      : selectedDocIds;
    if (!ids.length) {
      toast.error("This plan needs at least one source file for practice.");
      return;
    }

    setSelectedTopicId(topic.id);
    setPracticeLoading(true);
    setReview(null);
    setAnswers({});
    try {
      const studyDocs = await loadStudyDocuments(ids, topic.title);
      const exclude = askedByTopicRef.current[topic.id] ?? [];
      const lastScore = opts?.continuing
        ? (opts.lastScore ?? Number(topic.mastery_score || 0))
        : Number(topic.mastery_score || 0);
      const generated = await generateStudyQuestions({
        profile,
        topic,
        questionType,
        count: questionCount,
        documents: studyDocs,
        excludePrompts: exclude,
        difficultyHint: difficultyFromScore(lastScore),
      });
      if (!generated.questions.length) {
        toast.message(
          "No fresh questions left from this material for the topic. Try another topic or add more files.",
        );
        return;
      }

      const { data: sessionData, error: sessionErr } = await db
        .from("study_sessions")
        .insert({
          user_id: user.id,
          plan_id: activePlan.id,
          topic_id: topic.id,
          question_type: questionType,
          requested_count: questionCount,
          total_questions: generated.questions.length,
        })
        .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
        .single();
      if (sessionErr) throw sessionErr;
      const session = sessionData as SessionRow;

      const questionRows = generated.questions.map((question: GeneratedQuestion, index: number) => {
        const normalizedType: "mcq" | "essay" =
          question.type === "essay" || questionType === "essay" ? "essay" : "mcq";
        return {
          user_id: user.id,
          session_id: session.id,
          plan_id: activePlan.id,
          topic_id: topic.id,
          question_type: normalizedType,
          prompt: question.prompt,
          options: normalizedType === "mcq" ? (question.options ?? []) : [],
          correct_answer: question.correct_answer,
          explanation: question.explanation ?? "",
          rubric: question.rubric ?? [],
          difficulty: question.difficulty ?? "medium",
          source_refs: question.source_refs ?? [],
          position: index,
        };
      });

      const { data: savedQuestions, error: questionErr } = await db
        .from("study_questions")
        .insert(questionRows)
        .select(
          "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
        )
        .order("position", { ascending: true });
      if (questionErr) throw questionErr;

      askedByTopicRef.current[topic.id] = [
        ...exclude,
        ...generated.questions.map((question) => question.prompt),
      ];

      await db
        .from("study_topics")
        .update({ status: "practicing", last_practiced_at: new Date().toISOString() })
        .eq("id", topic.id);
      await refreshTopics(activePlan.id);

      setActiveSession(session as SessionRow);
      setQuestions((savedQuestions as QuestionRow[]) ?? []);
      toast.success(opts?.continuing ? "Next questions ready" : "Practice set ready");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start practice");
    } finally {
      setPracticeLoading(false);
    }
  };

  const startPractice = () => runPractice(activeTopic);
  const continuePractice = () =>
    runPractice(activeTopic, {
      continuing: true,
      lastScore: review ? Number(review.grading.percentage ?? 0) : null,
    });

  const submitPractice = async () => {
    if (!user || !profile || !activeSession || !activeTopic) return;
    const missing = questions.filter((question) => !answers[question.id]?.trim());
    if (missing.length) {
      toast.error("Answer every question before submitting.");
      return;
    }

    setReviewLoading(true);
    try {
      const result = await reviewStudyAnswers({
        profile,
        mode:
          (profile.preferred_mode as "Simplified" | "Detailed" | "Storytelling") || "Simplified",
        questions: questions.map((question) => ({
          id: question.id,
          type: question.question_type,
          prompt: question.prompt,
          options: question.options ?? [],
          correct_answer: question.correct_answer,
          explanation: question.explanation,
          rubric: question.rubric ?? [],
          source_refs: question.source_refs ?? [],
        })),
        answers,
      });

      const gradingAnswers = result.grading.answers ?? [];
      const answerRows = questions.map((question, index) => {
        const grade =
          gradingAnswers.find((item) => item.question_id === question.id) ??
          gradingAnswers[index] ??
          {};
        return {
          user_id: user.id,
          question_id: question.id,
          session_id: activeSession.id,
          answer: answers[question.id],
          is_correct: grade.is_correct ?? null,
          score: grade.score ?? null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });

      const percentage = Math.round(Number(result.grading.percentage ?? 0));
      const score = Number(result.grading.score ?? 0);
      await db.from("study_answers").insert(answerRows);
      await db
        .from("study_sessions")
        .update({
          status: "completed",
          score: percentage,
          feedback: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", activeSession.id);
      // Sustained mastery: blend the most recent sessions instead of letting a
      // single set define the topic, and only mark "mastered" after two recent
      // sets both clear the bar.
      const { data: recentRows } = await db
        .from("study_sessions")
        .select("score, status, created_at")
        .eq("topic_id", activeTopic.id)
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
        .eq("id", activeTopic.id);
      await db.from("study_preferences").upsert({
        user_id: user.id,
        preferred_question_type: questionType,
        correction_style: profile.preferred_mode || "Simplified",
        adaptive_notes: {
          weak_areas: result.grading.weak_areas ?? [],
          next_steps: result.grading.next_steps ?? [],
          last_score: percentage,
          raw_score: score,
        },
        updated_at: new Date().toISOString(),
      });

      setReview(result);
      setActiveSession({
        ...activeSession,
        status: "completed",
        score: percentage,
        feedback: result,
      });
      await refreshTopics(activeSession.plan_id);

      if (mastered) {
        const next = topics.find(
          (item) => item.id !== activeTopic.id && item.status !== "mastered",
        );
        if (next) {
          toast.success(`${activeTopic.title} mastered — moving to the next topic.`);
          await runPractice(next);
        } else {
          toast.success("Roadmap complete — every topic is mastered.");
        }
      } else {
        toast.success("Practice reviewed — keep going to master this topic.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not review answers");
    } finally {
      setReviewLoading(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 overflow-x-hidden">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-primary">
              <MapIcon className="h-4 w-4" />
              StudyBody
            </div>
            <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
              Build a roadmap, practice, and improve.
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              DeepSeek reads the study material. OpenAI shapes the final coaching.
            </p>
          </div>
          <div className="grid w-full max-w-full grid-cols-3 gap-1.5 text-center sm:w-auto sm:min-w-72 sm:gap-2">
            <Metric label="Plans" value={plans.length.toString()} />
            <Metric label="Topics" value={topics.length.toString()} />
            <Metric label="Mastery" value={`${averageMastery}%`} />
          </div>
        </header>

        {schemaMissing && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="font-semibold text-destructive">
              StudyBody database tables are missing
            </div>
            <p className="mt-1 text-muted-foreground">
              Apply the migration{" "}
              <span className="font-mono">
                supabase/migrations/20260508000100_add_studybody.sql
              </span>{" "}
              in Supabase, then refresh this page. Roadmap generation is paused so AI credits are
              not wasted before the tables exist.
            </p>
          </div>
        )}

        <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="luxury-panel rounded-lg p-4">
              <div className="mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">New roadmap</h2>
              </div>
              <input
                value={planTitle}
                onChange={(event) => setPlanTitle(event.target.value)}
                placeholder="Course or topic name"
                className="mb-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <textarea
                value={courseOutline}
                onChange={(event) => setCourseOutline(event.target.value)}
                placeholder="Paste course outline, or leave blank and build from selected files"
                className="min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <span>Sources</span>
                  <span>{selectedDocIds.length} selected</span>
                </div>
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  {docs.length === 0 ? (
                    <Link
                      to="/app/library"
                      className="block rounded-lg border border-border p-3 text-sm text-primary"
                    >
                      Upload files in Library
                    </Link>
                  ) : (
                    docs.map((doc) => (
                      <button
                        key={doc.id}
                        onClick={() => toggleDoc(doc.id)}
                        className={`flex min-w-0 w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                          selectedDocIds.includes(doc.id)
                            ? "border-primary/40 bg-primary/10"
                            : "border-border bg-surface/30 hover:border-primary/30"
                        }`}
                      >
                        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        <span className="min-w-0 flex-1">
                          <span className="block break-words font-medium">{doc.file_name}</span>
                          <span className="block break-words text-xs text-muted-foreground">
                            {folderName(doc) || "Uncategorised"}
                          </span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
              <button
                onClick={createPlan}
                disabled={loading}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-60"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                Build roadmap
              </button>
            </div>

            <div className="luxury-panel rounded-lg p-4">
              <div className="mb-3 flex items-center gap-2">
                <Target className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Roadmaps</h2>
              </div>
              <div className="space-y-2">
                {plans.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                    No roadmaps yet.
                  </div>
                ) : (
                  plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`min-w-0 w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                        selectedPlanId === plan.id
                          ? "border-primary/40 bg-primary/10"
                          : "border-border bg-surface/30 hover:border-primary/30"
                      }`}
                    >
                      <span className="block break-words font-medium">{plan.title}</span>
                      <span className="text-xs text-muted-foreground">{plan.source_type}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="luxury-panel rounded-lg p-4">
              <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-semibold">{activePlan?.title || "Roadmap"}</h2>
                  <p className="text-sm text-muted-foreground">
                    {activePlan
                      ? `${topics.length} topics - ${activePlan.source_type}`
                      : "Create or select a roadmap"}
                  </p>
                </div>
                {activePlan && (
                  <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                    <Trophy className="h-4 w-4 text-primary" />
                    {masteredCount}/{topics.length} mastered
                  </div>
                )}
              </div>

              {activePlan && topics.length > 0 && (
                <div className="mb-4">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Roadmap progress</span>
                    <span className="font-semibold text-foreground">{averageMastery}%</span>
                  </div>
                  <ProgressBar value={averageMastery} />
                </div>
              )}

              <div className="space-y-3">
                {topics.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                    Your roadmap topics will appear here.
                  </div>
                ) : (
                  topics.map((topic, index) => (
                    <button
                      key={topic.id}
                      onClick={() => {
                        setSelectedTopicId(topic.id);
                        setActiveSession(null);
                        setQuestions([]);
                        setAnswers({});
                        setReview(null);
                      }}
                      className={`w-full min-w-0 rounded-lg border p-3 text-left transition-colors ${
                        selectedTopicId === topic.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-surface/25 hover:border-primary/30"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                              {index + 1}
                            </span>
                            <span className="min-w-0 flex-1 break-words">{topic.title}</span>
                          </div>
                          {topic.status === "mastered" && (
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          )}
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground break-words">
                          {topic.summary || "No summary yet."}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground break-words">
                          {sourceText(topic.source_refs)}
                        </p>
                        <div className="mt-3 flex items-center gap-2">
                          <ProgressBar
                            value={Math.round(Number(topic.mastery_score || 0))}
                            className="flex-1"
                          />
                          <span className="shrink-0 text-xs font-semibold">
                            {Math.round(Number(topic.mastery_score || 0))}%
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {STATUS_LABEL[topic.status]}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            <aside className="luxury-panel min-w-0 rounded-lg p-4">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Practice</h2>
              </div>

              {activeTopic ? (
                <>
                  <div className="rounded-lg border border-border bg-surface/30 p-3">
                    <div className="text-sm font-semibold">{activeTopic.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeTopic.summary}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-1.5 sm:gap-2">
                    {(["mcq", "essay", "mixed"] as StudyQuestionType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => setQuestionType(type)}
                        className={`rounded-lg border px-2 py-2 text-sm font-medium capitalize sm:px-3 ${
                          questionType === type
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-1.5 sm:gap-2">
                    {QUESTION_COUNTS.map((count) => (
                      <button
                        key={count}
                        onClick={() => setQuestionCount(count)}
                        className={`rounded-lg border px-2 py-2 text-sm font-medium sm:px-3 ${
                          questionCount === count
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        {count}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={startPractice}
                    disabled={practiceLoading}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {practiceLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Start practice
                  </button>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  Pick a topic to practice.
                </div>
              )}

              {questions.length > 0 && (
                <div className="mt-5 space-y-4">
                  {questions.map((question, index) => (
                    <div
                      key={question.id}
                      className="rounded-lg border border-border bg-background/50 p-3"
                    >
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {question.question_type} - {question.difficulty} - {index + 1}
                      </div>
                      <p className="text-sm font-medium break-words">{question.prompt}</p>
                      {Array.isArray(question.source_refs) && question.source_refs.length > 0 ? (
                        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground break-words">
                          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                          <span className="min-w-0">
                            Source: {sourceText(question.source_refs)}
                          </span>
                        </p>
                      ) : (
                        <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-600 break-words dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0">
                            Not found in your material — answer with caution.
                          </span>
                        </p>
                      )}
                      {question.question_type === "mcq" ? (
                        <div className="mt-3 space-y-2">
                          {(question.options ?? []).map((option) => (
                            <button
                              key={option.id}
                              onClick={() =>
                                setAnswers((current) => ({ ...current, [question.id]: option.id }))
                              }
                              className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                                answers[question.id] === option.id
                                  ? "border-primary/50 bg-primary/10"
                                  : "border-border hover:border-primary/30"
                              }`}
                            >
                              <span className="shrink-0 font-semibold">{option.id}</span>
                              <span className="min-w-0 flex-1 break-words">{option.text}</span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <textarea
                          value={answers[question.id] ?? ""}
                          onChange={(event) =>
                            setAnswers((current) => ({
                              ...current,
                              [question.id]: event.target.value,
                            }))
                          }
                          placeholder="Write your answer"
                          className="mt-3 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                        />
                      )}
                    </div>
                  ))}

                  <button
                    onClick={submitPractice}
                    disabled={reviewLoading || activeSession?.status === "completed"}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {reviewLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Submit and review
                  </button>
                </div>
              )}

              {review && (
                <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-semibold">Review</span>
                    <span className="text-sm font-semibold">
                      {Math.round(Number(review.grading.percentage ?? 0))}%
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                    {review.coaching}
                  </p>
                  {activeTopic && activeTopic.status !== "mastered" && (
                    <button
                      onClick={continuePractice}
                      disabled={practiceLoading}
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                    >
                      {practiceLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Play className="h-4 w-4" />
                      )}
                      Continue with new questions
                    </button>
                  )}
                </div>
              )}
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`h-2 overflow-hidden rounded-full bg-surface/60 ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 px-3 py-2">
      <div className="text-base font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
