import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  Play,
  Trophy,
  XCircle,
} from "lucide-react";
import { LoadingDots } from "@/components/loading-dots";
import { PageHeader } from "@/components/ui/page-header";
import { Segmented } from "@/components/ui/segmented";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import {
  generateFlashcards,
  generateStudyQuestions,
  reviewStudyAnswers,
  type StudyQuestionType,
  type StudyReview,
} from "@/lib/studybody-client";
import {
  db,
  difficultyFromScore,
  finalizeTopicMastery,
  loadStudyDocuments,
  sourceText,
  STATUS_LABEL,
  type PlanRow,
  type QuestionRow,
  type SessionRow,
  type TopicRow,
} from "@/lib/studybody-data";
import { getCached, setCached } from "@/lib/data-cache";
import { recordGamificationEvent, recordRoadmapCompletedOnce } from "@/lib/gamification";

type PracticeSearch = { plan?: string; session?: string; mode?: PracticeMode };

type PracticeMode = "learning" | "exam";

type Flashcard = {
  id: string;
  front: string;
  back: string;
  source_refs: unknown[];
};

// Local grade for a single question. MCQ grades are computed on-device by
// comparing against the stored correct option; essays carry the AI grade.
type Grade = {
  is_correct: boolean | null;
  score: number | null;
  feedback?: string;
  missing_points?: string[];
};

// Treat an essay as "correct" for counts when it scored at least half marks.
function isGradeCorrect(grade: Grade | undefined): boolean {
  if (!grade) return false;
  if (typeof grade.score === "number") return grade.score >= 0.5;
  return grade.is_correct === true;
}

function gradePoints(grade: Grade | undefined): number {
  if (!grade) return 0;
  if (typeof grade.score === "number") return Math.max(0, Math.min(1, grade.score));
  return grade.is_correct ? 1 : 0;
}

function optionLabel(question: QuestionRow, optionId: string | undefined): string {
  if (!optionId) return "-";
  const match = (question.options ?? []).find((option) => option.id === optionId);
  return match ? `${match.id}. ${match.text}` : optionId;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function SourceOrWarn({ question }: { question: QuestionRow }) {
  if (Array.isArray(question.source_refs) && question.source_refs.length > 0) {
    return (
      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-pop/5 px-2.5 py-1.5 text-xs text-muted-foreground break-words">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
        <span className="min-w-0">Source: {sourceText(question.source_refs)}</span>
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-600 break-words dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">Not found in your material - answer with caution.</span>
    </p>
  );
}

// The post-answer panel: correct answer, explanation, source, and (for essays)
// the AI feedback. Used inline in Learning mode and in the Exam review list.
function AnswerFeedback({ question, grade }: { question: QuestionRow; grade?: Grade }) {
  const correctText =
    question.question_type === "mcq"
      ? optionLabel(question, question.correct_answer)
      : question.correct_answer;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-leaf/30 bg-leaf/[0.08] p-3 text-sm">
      <p className="flex items-start gap-1.5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-leaf" />
        <span className="min-w-0 break-words">
          <span className="font-semibold">Correct answer: </span>
          {correctText}
        </span>
      </p>
      {question.explanation ? (
        <p className="break-words text-muted-foreground">
          <span className="font-semibold text-foreground">Explanation: </span>
          {question.explanation}
        </p>
      ) : null}
      <p className="flex items-start gap-1.5 break-words text-xs text-muted-foreground">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
        <span className="min-w-0">
          <span className="font-semibold">Source: </span>
          {sourceText(question.source_refs)}
        </span>
      </p>
      {grade?.feedback ? (
        <p className="break-words text-muted-foreground">
          <span className="font-semibold text-foreground">Feedback: </span>
          {grade.feedback}
        </p>
      ) : null}
    </div>
  );
}

// Count presets per practice type, plus a Custom option for any amount.
const COUNT_OPTIONS: Record<"mcq" | "essay" | "flashcard", number[]> = {
  mcq: [10, 30, 50],
  essay: [5, 10, 15],
  flashcard: [10, 30, 60],
};

const MIXED_PRESETS = [
  { mcq: 10, essay: 3 },
  { mcq: 30, essay: 10 },
  { mcq: 50, essay: 15 },
];

const TYPE_LABEL: Record<StudyQuestionType, string> = {
  mcq: "MCQ",
  essay: "Essay",
  mixed: "Mixed",
  flashcard: "Flash cards",
};

function clampCount(value: number): number {
  if (Number.isNaN(value)) return 1;
  return Math.min(Math.max(Math.round(value), 1), 60);
}

async function awardRoadmapIfComplete(userId: string, planId: string) {
  const { data } = await db
    .from("study_topics")
    .select("status")
    .eq("user_id", userId)
    .eq("plan_id", planId);
  const topics = (data as Array<{ status: string | null }> | null) ?? [];
  if (topics.length > 0 && topics.every((topic) => topic.status === "mastered")) {
    recordRoadmapCompletedOnce(userId, planId);
  }
}

export function PracticePage() {
  const search = useSearch({ from: "/app/practice" }) as PracticeSearch;
  const planId = search.plan;
  const sessionId = search.session;

  if (!planId) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-2xl flex-col items-start">
          <p className="text-sm text-muted-foreground">No roadmap selected.</p>
          <Link
            to="/app/studybody"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-pop transition-colors hover:text-pop/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Coach
          </Link>
        </div>
      </div>
    );
  }

  if (sessionId) {
    return <SessionView sessionId={sessionId} planId={planId} modeParam={search.mode} />;
  }

  return <ConfigView planId={planId} />;
}

function ConfigView({ planId }: { planId: string }) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [planLoading, setPlanLoading] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);

  const [questionType, setQuestionType] = useState<StudyQuestionType>("mcq");
  const [count, setCount] = useState(10);
  const [mixedMcq, setMixedMcq] = useState(10);
  const [mixedEssay, setMixedEssay] = useState(3);
  const [customMode, setCustomMode] = useState(false);
  const [practiceMode, setPracticeMode] = useState<PracticeMode>("learning");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [practiceLoading, setPracticeLoading] = useState(false);
  // An unfinished set for the selected topic, so the student can pick up where
  // they stopped instead of generating (and paying for) a brand-new one.
  const [resumable, setResumable] = useState<{
    id: string;
    answered: number;
    total: number;
    questionType: StudyQuestionType;
  } | null>(null);

  // Learning/Exam modes only apply to question sets that contain MCQs.
  const supportsModes = questionType === "mcq" || questionType === "mixed";
  // Difficulty applies to graded question sets, not flashcards.
  const supportsDifficulty = questionType !== "flashcard";

  const activeTopic = useMemo(
    () => topics.find((topic) => topic.id === selectedTopicId) ?? null,
    [topics, selectedTopicId],
  );
  const masteredCount = useMemo(
    () => topics.filter((topic) => topic.status === "mastered").length,
    [topics],
  );

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      // Hydrate from the cached plan/topics first so revisiting doesn't flash a
      // spinner; the fetch below revalidates.
      const cached = getCached<{ plan: PlanRow; topics: TopicRow[] }>(`plan:${planId}`);
      if (cached) {
        setPlan(cached.plan);
        setTopics(cached.topics);
        setSelectedTopicId((current) =>
          current && cached.topics.some((topic) => topic.id === current)
            ? current
            : cached.topics[0]?.id || "",
        );
      } else {
        setPlanLoading(true);
      }
      const { data: planData, error: planErr } = await db
        .from("study_plans")
        .select(
          "id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at",
        )
        .eq("id", planId)
        .eq("user_id", user.id)
        .single();
      if (!active) return;
      if (planErr) {
        setPlanLoading(false);
        if (planErr.code === "PGRST205" || planErr.message.includes("study_plans")) {
          setSchemaMissing(true);
        } else {
          toast.error(planErr.message);
        }
        return;
      }
      setPlan(planData as PlanRow);
      const { data: topicData, error: topicErr } = await db
        .from("study_topics")
        .select(
          "id, plan_id, title, summary, objectives, source_refs, position, status, mastery_score, last_practiced_at",
        )
        .eq("user_id", user.id)
        .eq("plan_id", planId)
        .order("position", { ascending: true });
      if (!active) return;
      setPlanLoading(false);
      if (topicErr) {
        toast.error(topicErr.message);
        return;
      }
      const nextTopics = (topicData as TopicRow[]) ?? [];
      setTopics(nextTopics);
      setSelectedTopicId((current) =>
        current && nextTopics.some((topic) => topic.id === current)
          ? current
          : nextTopics[0]?.id || "",
      );
      setCached(`plan:${planId}`, { plan: planData as PlanRow, topics: nextTopics });
    })();
    return () => {
      active = false;
    };
  }, [user, planId]);

  // Look for the most recent unfinished set on the selected topic so we can
  // offer "Continue" instead of forcing a regenerate.
  useEffect(() => {
    if (!user || !selectedTopicId) {
      setResumable(null);
      return;
    }
    let active = true;
    (async () => {
      const { data } = await db
        .from("study_sessions")
        .select("id, question_type, total_questions, feedback, created_at")
        .eq("user_id", user.id)
        .eq("topic_id", selectedTopicId)
        .eq("status", "in_progress")
        .order("created_at", { ascending: false });
      if (!active) return;
      const rows =
        (data as
          | {
              id: string;
              question_type: StudyQuestionType;
              total_questions: number;
              feedback: Record<string, unknown> | null;
            }[]
          | null) ?? [];
      // Only sets that actually have questions saved are worth resuming.
      const row = rows.find((item) => item.total_questions > 0);
      if (!row) {
        setResumable(null);
        return;
      }
      const draft =
        (row.feedback as { draftAnswers?: Record<string, string> } | null)?.draftAnswers ?? {};
      const answered = Object.values(draft).filter(
        (value) => typeof value === "string" && value.trim().length > 0,
      ).length;
      setResumable({
        id: row.id,
        answered,
        total: row.total_questions,
        questionType: row.question_type,
      });
    })();
    return () => {
      active = false;
    };
  }, [user, selectedTopicId]);

  const changeType = (type: StudyQuestionType) => {
    setQuestionType(type);
    setCustomMode(false);
    if (type !== "mixed") setCount(COUNT_OPTIONS[type][0]);
  };

  const start = async () => {
    if (!user || !profile || !plan || !activeTopic) return;
    if (schemaMissing) {
      toast.error("My Coach tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    const ids = plan.source_document_ids ?? [];
    if (!ids.length) {
      toast.error("This roadmap has no source files to practice from.");
      return;
    }

    setPracticeLoading(true);
    try {
      const studyDocs = await loadStudyDocuments(ids, activeTopic.title);

      if (questionType === "flashcard") {
        const generated = await generateFlashcards({
          profile,
          topic: activeTopic,
          count,
          documents: studyDocs,
        });
        if (!generated.flashcards.length) {
          toast.message("No flashcards could be built from this material. Try another topic.");
          return;
        }
        const { data: sessionData, error: sessionErr } = await db
          .from("study_sessions")
          .insert({
            user_id: user.id,
            plan_id: plan.id,
            topic_id: activeTopic.id,
            question_type: "flashcard",
            requested_count: count,
            total_questions: generated.flashcards.length,
          })
          .select("id")
          .single();
        if (sessionErr) throw sessionErr;
        const session = sessionData as { id: string };

        const cardRows = generated.flashcards.map((card, index) => ({
          user_id: user.id,
          session_id: session.id,
          plan_id: plan.id,
          topic_id: activeTopic.id,
          question_type: "flashcard",
          prompt: card.front,
          options: [],
          correct_answer: card.back,
          explanation: "",
          rubric: [],
          difficulty: "medium",
          source_refs: card.source_refs ?? [],
          position: index,
        }));
        const { error: cardErr } = await db.from("study_questions").insert(cardRows);
        if (cardErr) throw cardErr;

        await db
          .from("study_topics")
          .update({ status: "practicing", last_practiced_at: new Date().toISOString() })
          .eq("id", activeTopic.id);
        navigate({ to: "/app/practice", search: { plan: planId, session: session.id } });
        return;
      }

      const sessionMode: PracticeMode | undefined = supportsModes ? practiceMode : undefined;
      const isMixed = questionType === "mixed";
      const requestedCount = isMixed ? mixedMcq + mixedEssay : count;
      const generated = await generateStudyQuestions({
        profile,
        topic: activeTopic,
        questionType,
        count: requestedCount,
        mcqCount: isMixed ? mixedMcq : undefined,
        essayCount: isMixed ? mixedEssay : undefined,
        documents: studyDocs,
        difficultyHint: difficultyFromScore(Number(activeTopic.mastery_score || 0)),
        difficulty,
      });
      if (!generated.questions.length) {
        toast.message("No questions could be built from this material. Try another topic.");
        return;
      }

      const { data: sessionData, error: sessionErr } = await db
        .from("study_sessions")
        .insert({
          user_id: user.id,
          plan_id: plan.id,
          topic_id: activeTopic.id,
          question_type: questionType,
          requested_count: requestedCount,
          total_questions: generated.questions.length,
          // Persist the mode up front so a resumed set keeps Learning/Exam even
          // before the first answer is autosaved.
          feedback: sessionMode ? { mode: sessionMode } : {},
        })
        .select("id")
        .single();
      if (sessionErr) throw sessionErr;
      const session = sessionData as { id: string };

      const questionRows = generated.questions.map((question, index) => {
        const normalizedType: "mcq" | "essay" = question.type === "essay" ? "essay" : "mcq";
        return {
          user_id: user.id,
          session_id: session.id,
          plan_id: plan.id,
          topic_id: activeTopic.id,
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
      const { error: questionErr } = await db.from("study_questions").insert(questionRows);
      if (questionErr) throw questionErr;

      await db
        .from("study_topics")
        .update({ status: "practicing", last_practiced_at: new Date().toISOString() })
        .eq("id", activeTopic.id);
      navigate({
        to: "/app/practice",
        search: { plan: planId, session: session.id, mode: sessionMode },
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start practice");
    } finally {
      setPracticeLoading(false);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 overflow-x-hidden">
        <div className="flex flex-col gap-4">
          <Link
            to="/app/studybody"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Coach
          </Link>
          <PageHeader
            eyebrow="My Coach"
            title={plan?.title || "Roadmap practice"}
            subtitle={plan ? `${topics.length} topics - ${plan.source_type}` : "Loading roadmap…"}
            actions={
              plan && topics.length > 0 ? (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 text-sm font-medium">
                  <Trophy className="h-4 w-4 text-leaf" />
                  {masteredCount}/{topics.length} mastered
                </div>
              ) : undefined
            }
          />
        </div>

        {schemaMissing && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
            <div className="font-semibold text-destructive">
              My Coach database tables are missing
            </div>
            <p className="mt-1 text-muted-foreground">
              Apply the migration{" "}
              <span className="font-mono">
                supabase/migrations/20260508000100_add_studybody.sql
              </span>{" "}
              in Supabase, then refresh.
            </p>
          </div>
        )}

        {planLoading && !plan ? (
          <div className="flex justify-center py-16">
            <LoadingDots size="md" className="text-pop" />
          </div>
        ) : (
          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Topics */}
            <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-pop" />
                <h2 className="font-semibold tracking-[-0.01em]">Pick a topic</h2>
              </div>
              <div className="space-y-3">
                {topics.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                    This roadmap has no topics yet.
                  </div>
                ) : (
                  topics.map((topic, index) => (
                    <button
                      key={topic.id}
                      onClick={() => setSelectedTopicId(topic.id)}
                      className={`w-full min-w-0 rounded-xl border p-3.5 text-left transition-colors ${
                        selectedTopicId === topic.id
                          ? "border-pop/50 bg-pop/10"
                          : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <div className="flex min-w-0 items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs">
                            {index + 1}
                          </span>
                          <span className="min-w-0 flex-1 break-words">{topic.title}</span>
                        </div>
                        {topic.status === "mastered" && (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-leaf" />
                        )}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground break-words">
                        {topic.summary || "No summary yet."}
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <ProgressBar
                          value={Math.round(Number(topic.mastery_score || 0))}
                          className="flex-1"
                        />
                        <span className="shrink-0 text-xs font-semibold tabular-nums">
                          {Math.round(Number(topic.mastery_score || 0))}%
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {STATUS_LABEL[topic.status]}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Options */}
            <aside className="min-w-0 rounded-2xl border border-border bg-surface p-4 sm:p-5">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-pop" />
                <h2 className="font-semibold tracking-[-0.01em]">Set up practice</h2>
              </div>

              {activeTopic ? (
                <>
                  <div className="rounded-xl border border-border bg-background/40 p-3">
                    <div className="text-sm font-semibold">{activeTopic.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeTopic.summary}</p>
                  </div>

                  {resumable && (
                    <button
                      onClick={() =>
                        navigate({ to: "/app/practice", search: { plan: planId, session: resumable.id } })
                      }
                      className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl border border-pop/40 bg-pop/10 px-3 py-2.5 text-left transition-colors hover:bg-pop/15"
                    >
                      <span className="flex items-center gap-2">
                        <Play className="h-4 w-4 text-pop" />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-pop">
                            Continue where you left off
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {TYPE_LABEL[resumable.questionType]} ·{" "}
                            {resumable.answered}/{resumable.total} answered - no new questions
                          </span>
                        </span>
                      </span>
                    </button>
                  )}

                  {resumable && (
                    <div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Or start a new set
                    </div>
                  )}

                  <div className="mt-4">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                      Question type
                    </div>
                    <Segmented
                      options={["mcq", "essay", "mixed", "flashcard"] as StudyQuestionType[]}
                      value={questionType}
                      onChange={changeType}
                      getLabel={(type) => TYPE_LABEL[type]}
                      getIcon={(type) => (type === "flashcard" ? <Layers className="h-3.5 w-3.5" /> : null)}
                      className="h-10"
                    />
                  </div>

                  {supportsModes && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Mode</div>
                      <Segmented
                        options={["learning", "exam"] as const}
                        value={practiceMode}
                        onChange={setPracticeMode}
                        getLabel={(value) => (value === "learning" ? "Learning" : "Exam")}
                        getIcon={(value) =>
                          value === "learning" ? (
                            <Brain className="h-3.5 w-3.5" />
                          ) : (
                            <GraduationCap className="h-3.5 w-3.5" />
                          )
                        }
                        className="h-10"
                      />
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {practiceMode === "learning"
                          ? "Instant feedback after each answer."
                          : "Answers are graded when you submit."}
                      </p>
                    </div>
                  )}

                  {supportsDifficulty && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                        Difficulty
                      </div>
                      <Segmented
                        options={["easy", "medium", "hard"] as const}
                        value={difficulty}
                        onChange={setDifficulty}
                        getLabel={(value) =>
                          value === "easy" ? "Easy" : value === "medium" ? "Medium" : "Hard"
                        }
                        className="h-10"
                      />
                      <p className="mt-1.5 text-[11px] text-muted-foreground">
                        {difficulty === "easy"
                          ? "Recall the facts."
                          : difficulty === "medium"
                            ? "Apply & understand."
                            : "Exam-topper level - tough, multi-step questions, but every one stays answerable from your uploaded files."}
                      </p>
                    </div>
                  )}

                  <div className="mt-3">
                    {questionType === "mixed" ? (
                      <>
                        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                          How many
                        </div>
                        <div className="grid grid-cols-1 gap-1.5 sm:gap-2">
                          {MIXED_PRESETS.map((preset) => {
                            const selected =
                              !customMode && mixedMcq === preset.mcq && mixedEssay === preset.essay;
                            return (
                              <button
                                key={`${preset.mcq}-${preset.essay}`}
                                onClick={() => {
                                  setCustomMode(false);
                                  setMixedMcq(preset.mcq);
                                  setMixedEssay(preset.essay);
                                }}
                                className={`rounded-xl border px-3 py-2 text-left text-xs font-medium transition-colors ${
                                  selected
                                    ? "border-pop/50 bg-pop/10 text-pop"
                                    : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                                }`}
                              >
                                {preset.mcq} MCQ + {preset.essay} Essay
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setCustomMode(true)}
                          className={`mt-2 w-full rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                            customMode
                              ? "border-pop/50 bg-pop/10 text-pop"
                              : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                          }`}
                        >
                          Custom
                        </button>
                        {customMode && (
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              MCQ
                              <input
                                type="number"
                                min={0}
                                max={60}
                                value={mixedMcq}
                                onChange={(event) =>
                                  setMixedMcq(
                                    Math.min(
                                      Math.max(Number.parseInt(event.target.value, 10) || 0, 0),
                                      60,
                                    ),
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                              />
                            </label>
                            <label className="text-xs font-medium text-muted-foreground">
                              Essay
                              <input
                                type="number"
                                min={0}
                                max={60}
                                value={mixedEssay}
                                onChange={(event) =>
                                  setMixedEssay(
                                    Math.min(
                                      Math.max(Number.parseInt(event.target.value, 10) || 0, 0),
                                      60,
                                    ),
                                  )
                                }
                                className="mt-1 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                              />
                            </label>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                          How many
                        </div>
                        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                          {COUNT_OPTIONS[questionType].map((option) => (
                            <button
                              key={option}
                              onClick={() => {
                                setCustomMode(false);
                                setCount(option);
                              }}
                              className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
                                !customMode && count === option
                                  ? "border-pop/50 bg-pop/10 text-pop"
                                  : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                          <button
                            onClick={() => setCustomMode(true)}
                            className={`rounded-xl border px-2 py-2 text-sm font-medium transition-colors ${
                              customMode
                                ? "border-pop/50 bg-pop/10 text-pop"
                                : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
                            }`}
                          >
                            Custom
                          </button>
                        </div>
                        {customMode && (
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={count}
                            onChange={(event) =>
                              setCount(clampCount(Number.parseInt(event.target.value, 10)))
                            }
                            placeholder="How many? (1-60)"
                            className="mt-2 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40"
                          />
                        )}
                      </>
                    )}
                  </div>

                  <button
                    onClick={start}
                    disabled={practiceLoading}
                    className="btn-pop mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                  >
                    {practiceLoading ? (
                      <LoadingDots />
                    ) : questionType === "flashcard" ? (
                      <Layers className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {practiceLoading
                      ? "Building your set…"
                      : questionType === "flashcard"
                        ? resumable
                          ? "Start new flash cards"
                          : "Start flash cards"
                        : resumable
                          ? "Start new practice"
                          : "Start practice"}
                  </button>
                  {practiceLoading && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Larger sets take a little longer to build from your files.
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
                  Pick a topic to practice.
                </div>
              )}
            </aside>
          </section>
        )}
      </div>
    </div>
  );
}

function SessionView({
  sessionId,
  planId,
  modeParam,
}: {
  sessionId: string;
  planId: string;
  modeParam?: PracticeMode;
}) {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<SessionRow | null>(null);
  const [topicTitle, setTopicTitle] = useState("");
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [review, setReview] = useState<StudyReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Mode-aware (MCQ / Mixed) practice state.
  const [grades, setGrades] = useState<Record<string, Grade>>({});
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [revealedEssays, setRevealedEssays] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);

  const [fcIndex, setFcIndex] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcRatings, setFcRatings] = useState<Record<string, "got_it" | "missed">>({});
  const [fcDone, setFcDone] = useState(false);
  const [fcResult, setFcResult] = useState<number | null>(null);

  const isFlashcards = session?.question_type === "flashcard";
  const usesModes = session?.question_type === "mcq" || session?.question_type === "mixed";
  const hasEssays = questions.some((question) => question.question_type === "essay");
  // Mode resolves from the persisted session first (so reopening a completed set
  // keeps its mode), then the URL param, defaulting to learning.
  const mode: PracticeMode =
    ((session?.feedback as { mode?: PracticeMode } | null)?.mode ?? modeParam ?? "learning");

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: sessionData, error: sessionErr } = await db
        .from("study_sessions")
        .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();
      if (!active) return;
      if (sessionErr || !sessionData) {
        setLoading(false);
        toast.error(sessionErr?.message ?? "Could not load this practice set.");
        return;
      }
      const sessionRow = sessionData as SessionRow;
      setSession(sessionRow);
      setCompleted(sessionRow.status === "completed");

      const [{ data: questionData }, { data: topicData }] = await Promise.all([
        db
          .from("study_questions")
          .select(
            "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
          )
          .eq("session_id", sessionId)
          .order("position", { ascending: true }),
        db.from("study_topics").select("title").eq("id", sessionRow.topic_id).single(),
      ]);
      if (!active) return;

      const rows = (questionData as QuestionRow[]) ?? [];
      setTopicTitle(((topicData as { title?: string } | null)?.title ?? "").toString());

      if (sessionRow.question_type === "flashcard") {
        setFlashcards(
          rows.map((row) => ({
            id: row.id,
            front: row.prompt,
            back: row.correct_answer,
            source_refs: row.source_refs ?? [],
          })),
        );
      } else {
        setQuestions(rows);
        const modeSession =
          sessionRow.question_type === "mcq" || sessionRow.question_type === "mixed";
        if (modeSession && sessionRow.status === "completed") {
          // Reopened a finished set - rebuild answers + grades from saved rows.
          const { data: answerData } = await db
            .from("study_answers")
            .select("question_id, answer, is_correct, score, feedback")
            .eq("session_id", sessionId);
          if (!active) return;
          const savedAnswers: Record<string, string> = {};
          const savedGrades: Record<string, Grade> = {};
          for (const row of (answerData as Record<string, unknown>[]) ?? []) {
            const qid = String(row.question_id ?? "");
            if (!qid) continue;
            savedAnswers[qid] = typeof row.answer === "string" ? row.answer : "";
            savedGrades[qid] = {
              is_correct: typeof row.is_correct === "boolean" ? row.is_correct : null,
              score: typeof row.score === "number" ? row.score : null,
              feedback: typeof row.feedback === "string" ? row.feedback : "",
            };
          }
          setAnswers(savedAnswers);
          setGrades(savedGrades);
          setExamSubmitted(true);
          const fb = sessionRow.feedback as
            | { time_taken_seconds?: number; review?: StudyReview }
            | null;
          if (typeof fb?.time_taken_seconds === "number") setElapsedSec(fb.time_taken_seconds);
          if (fb?.review) setReview(fb.review);
        } else if (sessionRow.status !== "completed") {
          // Resuming an unfinished set - restore the autosaved draft so the
          // student lands exactly where they stopped.
          const fb = sessionRow.feedback as {
            draftAnswers?: Record<string, string>;
            draftGrades?: Record<string, Grade>;
            draftRevealed?: Record<string, boolean>;
          } | null;
          if (fb?.draftAnswers && typeof fb.draftAnswers === "object") {
            setAnswers(fb.draftAnswers);
          }
          if (modeSession) {
            if (fb?.draftGrades && typeof fb.draftGrades === "object") setGrades(fb.draftGrades);
            if (fb?.draftRevealed && typeof fb.draftRevealed === "object") {
              setRevealedEssays(fb.draftRevealed);
            }
            // Start the timer used by Exam mode for this sitting.
            setStartedAt(Date.now());
          }
        }
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, sessionId]);

  // Autosave the in-progress answers (and Learning-mode grades) into the
  // session's feedback JSONB so a student who leaves can resume in place. Runs
  // only while the set is unfinished; the submit handlers overwrite feedback on
  // completion, which clears the draft. Debounced to avoid hammering the DB.
  useEffect(() => {
    if (!session || completed || isFlashcards) return;
    if (Object.keys(answers).length === 0) return;
    const timer = window.setTimeout(() => {
      const base = (session.feedback as Record<string, unknown> | null) ?? {};
      db.from("study_sessions")
        .update({
          feedback: {
            ...base,
            mode,
            draftAnswers: answers,
            draftGrades: grades,
            draftRevealed: revealedEssays,
          },
        })
        .eq("id", session.id)
        .then(({ error }) => {
          if (error) console.warn("autosave practice progress failed", error);
        });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [answers, grades, revealedEssays, completed, isFlashcards, session, mode]);

  const backToTopics = () => navigate({ to: "/app/practice", search: { plan: planId } });

  const submitPractice = async () => {
    if (!user || !profile || !session) return;
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
          session_id: session.id,
          answer: answers[question.id],
          is_correct: grade.is_correct ?? null,
          score: grade.score ?? null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });

      const percentage = Math.round(Number(result.grading.percentage ?? 0));
      await db.from("study_answers").insert(answerRows);
      await db
        .from("study_sessions")
        .update({
          status: "completed",
          score: percentage,
          feedback: result,
          completed_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      const mastered = await finalizeTopicMastery(session.topic_id, percentage);
      await db.from("study_preferences").upsert({
        user_id: user.id,
        preferred_question_type: session.question_type,
        correction_style: profile.preferred_mode || "Simplified",
        adaptive_notes: {
          weak_areas: result.grading.weak_areas ?? [],
          next_steps: result.grading.next_steps ?? [],
          last_score: percentage,
        },
        updated_at: new Date().toISOString(),
      });

      const correct = answerRows.filter(
        (row) => row.is_correct === true || Number(row.score ?? 0) >= 0.5,
      ).length;
      const failed = Math.max(0, answerRows.length - correct);
      if (correct) recordGamificationEvent(user.id, "coach_question_correct", { count: correct });
      if (failed) recordGamificationEvent(user.id, "coach_question_failed", { count: failed });
      recordGamificationEvent(user.id, "coach_session_completed");
      if (mastered) await awardRoadmapIfComplete(user.id, session.plan_id);

      setReview(result);
      setCompleted(true);
      toast.success(
        mastered ? `${topicTitle || "Topic"} mastered!` : "Practice reviewed - keep going.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not review answers");
    } finally {
      setReviewLoading(false);
    }
  };

  const gradeMcq = (question: QuestionRow, answer: string | undefined): Grade => {
    const correct = (answer ?? "") === question.correct_answer;
    return { is_correct: correct, score: correct ? 1 : 0 };
  };

  // Learning mode: lock the question and grade it the instant an option is picked.
  const answerLearningMcq = (question: QuestionRow, optionId: string) => {
    if (completed || grades[question.id]) return;
    setAnswers((current) => ({ ...current, [question.id]: optionId }));
    setGrades((current) => ({ ...current, [question.id]: gradeMcq(question, optionId) }));
  };

  // MCQs are graded on-device against the stored key; essays still need the AI.
  const buildGrades = async (): Promise<{
    map: Record<string, Grade>;
    review: StudyReview | null;
  }> => {
    const map: Record<string, Grade> = {};
    for (const question of questions) {
      if (question.question_type === "mcq") {
        map[question.id] = gradeMcq(question, answers[question.id]);
      }
    }
    const essays = questions.filter((question) => question.question_type === "essay");
    let review: StudyReview | null = null;
    if (essays.length && profile) {
      review = await reviewStudyAnswers({
        profile,
        mode:
          (profile.preferred_mode as "Simplified" | "Detailed" | "Storytelling") || "Simplified",
        questions: essays.map((question) => ({
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
      const gradingAnswers = review.grading.answers ?? [];
      essays.forEach((question, index) => {
        const grade =
          gradingAnswers.find((item) => item.question_id === question.id) ??
          gradingAnswers[index] ??
          {};
        map[question.id] = {
          is_correct: grade.is_correct ?? null,
          score: typeof grade.score === "number" ? grade.score : null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });
    }
    return { map, review };
  };

  const persistResults = async (
    map: Record<string, Grade>,
    review: StudyReview | null,
    elapsed: number | null,
  ): Promise<{ mastered: boolean; percentage: number } | undefined> => {
    if (!user || !session) return undefined;
    const answerRows = questions.map((question) => {
      const grade = map[question.id] ?? { is_correct: null, score: null };
      return {
        user_id: user.id,
        question_id: question.id,
        session_id: session.id,
        answer: answers[question.id] ?? "",
        is_correct: grade.is_correct,
        score: grade.score,
        feedback: grade.feedback ?? "",
        missing_points: grade.missing_points ?? [],
      };
    });
    const points = questions.reduce((sum, question) => sum + gradePoints(map[question.id]), 0);
    const percentage = questions.length ? Math.round((points / questions.length) * 100) : 0;

    await db.from("study_answers").insert(answerRows);
    await db
      .from("study_sessions")
      .update({
        status: "completed",
        score: percentage,
        feedback: { mode, time_taken_seconds: elapsed, review: review ?? null },
        completed_at: new Date().toISOString(),
      })
      .eq("id", session.id);
    const mastered = await finalizeTopicMastery(session.topic_id, percentage);
    await db.from("study_preferences").upsert({
      user_id: user.id,
      preferred_question_type: session.question_type,
      correction_style: profile?.preferred_mode || "Simplified",
      adaptive_notes: {
        weak_areas: review?.grading.weak_areas ?? [],
        next_steps: review?.grading.next_steps ?? [],
        last_score: percentage,
      },
      updated_at: new Date().toISOString(),
    });
    setCompleted(true);
    const correct = questions.filter((question) => isGradeCorrect(map[question.id])).length;
    const failed = Math.max(0, questions.length - correct);
    if (correct) recordGamificationEvent(user.id, "coach_question_correct", { count: correct });
    if (failed) recordGamificationEvent(user.id, "coach_question_failed", { count: failed });
    recordGamificationEvent(user.id, "coach_session_completed");
    if (mastered) await awardRoadmapIfComplete(user.id, session.plan_id);
    return { mastered, percentage };
  };

  const finishLearning = async () => {
    if (!user || !session || reviewLoading) return;
    setReviewLoading(true);
    try {
      const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
      const { map, review } = await buildGrades();
      setGrades(map);
      setElapsedSec(elapsed);
      if (review) setReview(review);
      const result = await persistResults(map, review, elapsed);
      toast.success(result?.mastered ? `${topicTitle || "Topic"} mastered!` : "Saved - nice work.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save results");
    } finally {
      setReviewLoading(false);
    }
  };

  const submitExam = async () => {
    if (!user || !session || reviewLoading) return;
    const missing = questions.filter((question) => !answers[question.id]?.trim());
    if (missing.length) {
      toast.error("Answer every question before submitting.");
      return;
    }
    setReviewLoading(true);
    try {
      const elapsed = startedAt ? Math.round((Date.now() - startedAt) / 1000) : null;
      const { map, review } = await buildGrades();
      setGrades(map);
      setElapsedSec(elapsed);
      if (review) setReview(review);
      setExamSubmitted(true);
      const result = await persistResults(map, review, elapsed);
      toast.success(result?.mastered ? `${topicTitle || "Topic"} mastered!` : "Quiz submitted.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit quiz");
    } finally {
      setReviewLoading(false);
    }
  };

  const finishFlashcards = async (ratings: Record<string, "got_it" | "missed">) => {
    if (!user || !session) return;
    const total = flashcards.length;
    const gotIt = flashcards.filter((card) => ratings[card.id] === "got_it").length;
    const percentage = total ? Math.round((gotIt / total) * 100) : 0;
    setFcDone(true);
    setFcResult(percentage);
    try {
      const answerRows = flashcards.map((card) => ({
        user_id: user.id,
        question_id: card.id,
        session_id: session.id,
        answer: ratings[card.id] ?? "missed",
        is_correct: ratings[card.id] === "got_it",
        score: ratings[card.id] === "got_it" ? 1 : 0,
        feedback: "",
        missing_points: [],
      }));
      await db.from("study_answers").insert(answerRows);
      await db
        .from("study_sessions")
        .update({ status: "completed", score: percentage, completed_at: new Date().toISOString() })
        .eq("id", session.id);
      const mastered = await finalizeTopicMastery(session.topic_id, percentage);
      setCompleted(true);
      if (gotIt) recordGamificationEvent(user.id, "coach_question_correct", { count: gotIt });
      if (total - gotIt) {
        recordGamificationEvent(user.id, "coach_question_failed", { count: total - gotIt });
      }
      recordGamificationEvent(user.id, "coach_session_completed");
      if (mastered) await awardRoadmapIfComplete(user.id, session.plan_id);
      toast.success("Flashcards reviewed");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save flashcard results");
    }
  };

  const rateCard = (rating: "got_it" | "missed") => {
    const card = flashcards[fcIndex];
    if (!card) return;
    const ratings = { ...fcRatings, [card.id]: rating };
    setFcRatings(ratings);
    if (fcIndex + 1 < flashcards.length) {
      setFcIndex(fcIndex + 1);
      setFcFlipped(false);
    } else {
      finishFlashcards(ratings);
    }
  };

  const currentCard = flashcards[fcIndex];

  // Derived scoreboard for mode-aware (MCQ / Mixed) sessions.
  const totalQuestions = questions.length;
  const correctCount = questions.filter((question) => isGradeCorrect(grades[question.id])).length;
  const incorrectCount = totalQuestions - correctCount;
  const scorePoints = questions.reduce(
    (sum, question) => sum + gradePoints(grades[question.id]),
    0,
  );
  const scorePercentage = totalQuestions ? Math.round((scorePoints / totalQuestions) * 100) : 0;
  const incorrectQuestions = questions.filter((question) => !isGradeCorrect(grades[question.id]));
  const allMcqGraded = questions
    .filter((question) => question.question_type === "mcq")
    .every((question) => grades[question.id]);
  const allEssaysWritten = questions
    .filter((question) => question.question_type === "essay")
    .every((question) => (answers[question.id] ?? "").trim());
  const learningReady = allMcqGraded && allEssaysWritten;
  // Presentational-only: how far through the set the student has progressed,
  // for the header progress bar. Not used by any submit/scoring logic.
  const answeredCount = questions.filter((question) =>
    (answers[question.id] ?? "").trim(),
  ).length;
  const sessionProgressPct = isFlashcards
    ? flashcards.length
      ? Math.round((Object.keys(fcRatings).length / flashcards.length) * 100)
      : 0
    : totalQuestions
      ? Math.round((answeredCount / totalQuestions) * 100)
      : 0;
  const showSessionProgress = !loading && !completed && (isFlashcards ? !fcDone : true);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 overflow-x-hidden">
        <div className="flex flex-col gap-4">
          <button
            onClick={backToTopics}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to topics
          </button>
          <PageHeader
            eyebrow="My Coach"
            title={topicTitle || "Practice session"}
            subtitle={
              isFlashcards
                ? "Flash cards"
                : usesModes
                  ? mode === "exam"
                    ? "Exam mode - graded when you submit"
                    : "Learning mode - instant feedback after each answer"
                  : "Practice"
            }
          />
          {showSessionProgress && (
            <div className="flex items-center gap-3">
              <ProgressBar value={sessionProgressPct} className="flex-1" />
              <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                {sessionProgressPct}%
              </span>
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-16">
            <LoadingDots size="md" className="text-pop" />
          </div>
        ) : (
          <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            {/* Flashcards */}
            {isFlashcards && !fcDone && currentCard && (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Card {fcIndex + 1} of {flashcards.length}
                  </span>
                  <span>{Object.keys(fcRatings).length} rated</span>
                </div>
                <div className="flex min-h-[280px] flex-col rounded-2xl border border-border bg-background/40 p-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {fcFlipped ? "Answer" : "Question"}
                  </div>
                  <p className="flex flex-1 items-center justify-center break-words px-1 py-4 text-center text-xl font-semibold leading-snug sm:text-2xl">
                    {fcFlipped ? currentCard.back : currentCard.front}
                  </p>
                  {fcFlipped &&
                    Array.isArray(currentCard.source_refs) &&
                    currentCard.source_refs.length > 0 && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-pop/5 px-2.5 py-1.5 text-xs text-muted-foreground break-words">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
                        <span className="min-w-0">
                          Source: {sourceText(currentCard.source_refs)}
                        </span>
                      </p>
                    )}
                </div>
                {!fcFlipped ? (
                  <button
                    onClick={() => setFcFlipped(true)}
                    className="btn-pop mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                  >
                    Show answer
                  </button>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => rateCard("missed")}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/15"
                    >
                      Missed
                    </button>
                    <button
                      onClick={() => rateCard("got_it")}
                      className="inline-flex items-center justify-center gap-2 rounded-xl border border-leaf/40 bg-leaf/15 px-4 py-2.5 text-sm font-semibold text-leaf transition-colors hover:bg-leaf/20"
                    >
                      Got it
                    </button>
                  </div>
                )}
              </div>
            )}

            {isFlashcards && fcDone && fcResult !== null && (
              <div className="rounded-2xl border border-pop/25 bg-pop/[0.06] p-5 text-center">
                <div className="text-sm font-semibold">Flash cards complete</div>
                <div className="mt-1 font-display text-4xl font-light">{fcResult}%</div>
                <p className="mt-1 text-sm text-muted-foreground">marked “got it”</p>
                <button
                  onClick={backToTopics}
                  className="btn-pop mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                >
                  Back to topics
                </button>
              </div>
            )}

            {/* MCQ / Mixed sessions: Learning (instant feedback) or Exam (graded at end) */}
            {usesModes && (
              <div className="space-y-4">
                {mode === "exam" && examSubmitted ? (
                  /* ---- Exam results ---- */
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-pop/25 bg-pop/[0.06] p-5 text-center">
                      <div className="text-sm font-semibold">Quiz complete</div>
                      <div className="mt-1 font-display text-4xl font-light">
                        {scorePercentage}%
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        <div className="rounded-xl border border-border bg-background/50 p-2">
                          <div className="font-display text-xl font-light">
                            {correctCount}/{totalQuestions}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Score</div>
                        </div>
                        <div className="rounded-xl border border-leaf/30 bg-leaf/10 p-2 text-leaf">
                          <div className="font-display text-xl font-light">{correctCount}</div>
                          <div className="text-[11px] opacity-80">Correct</div>
                        </div>
                        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                          <div className="font-display text-xl font-light">{incorrectCount}</div>
                          <div className="text-[11px] opacity-80">Incorrect</div>
                        </div>
                        <div className="rounded-xl border border-border bg-background/50 p-2">
                          <div className="flex items-center justify-center gap-1 font-display text-xl font-light">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatDuration(elapsedSec)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Time</div>
                        </div>
                      </div>
                    </div>

                    {review?.coaching ? (
                      <div className="rounded-2xl border border-pop/20 bg-pop/5 p-4">
                        <div className="mb-1 text-sm font-semibold">Coach notes</div>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {review.coaching}
                        </p>
                      </div>
                    ) : null}

                    {incorrectQuestions.length > 0 ? (
                      <div>
                        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                          <XCircle className="h-4 w-4 text-destructive" />
                          Incorrect questions review
                        </h3>
                        <div className="space-y-3">
                          {incorrectQuestions.map((question, index) => (
                            <div
                              key={question.id}
                              className="rounded-2xl border border-destructive/30 bg-destructive/5 p-3 sm:p-4"
                            >
                              <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                {question.question_type} · {index + 1}
                              </div>
                              <p className="text-sm font-medium break-words">{question.prompt}</p>
                              <p className="mt-2 flex items-start gap-1.5 text-sm break-words">
                                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                                <span className="min-w-0">
                                  <span className="font-semibold text-destructive">
                                    Your answer:{" "}
                                  </span>
                                  {question.question_type === "mcq"
                                    ? optionLabel(question, answers[question.id])
                                    : answers[question.id] || "-"}
                                </span>
                              </p>
                              <AnswerFeedback question={question} grade={grades[question.id]} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-leaf/30 bg-leaf/10 p-4 text-center text-sm font-medium text-leaf">
                        Perfect score - every question correct. 🎉
                      </div>
                    )}

                    <button
                      onClick={backToTopics}
                      className="btn-pop inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                    >
                      Back to topics
                    </button>
                  </div>
                ) : (
                  /* ---- Learning (always) and Exam (before submit) question list ---- */
                  <>
                    {questions.map((question, index) => {
                      const grade = grades[question.id];
                      const isMcq = question.question_type === "mcq";
                      const locked = mode === "learning" && isMcq && !!grade;
                      const showFeedback =
                        mode === "learning" &&
                        (isMcq ? !!grade : !!revealedEssays[question.id] || !!grade);
                      return (
                        <div
                          key={question.id}
                          className="rounded-2xl border border-border bg-background/40 p-3 sm:p-4"
                        >
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            {question.question_type} · {question.difficulty} · {index + 1}
                          </div>
                          <p className="text-sm font-medium break-words">{question.prompt}</p>
                          <SourceOrWarn question={question} />
                          {isMcq ? (
                            <div className="mt-3 space-y-2">
                              {(question.options ?? []).map((option) => {
                                const selected = answers[question.id] === option.id;
                                const isCorrectOption = option.id === question.correct_answer;
                                let cls = "border-border hover:border-pop/30 hover:bg-foreground/[0.02]";
                                if (showFeedback) {
                                  if (isCorrectOption)
                                    cls = "border-leaf/50 bg-leaf/10 text-leaf";
                                  else if (selected)
                                    cls = "border-destructive/60 bg-destructive/10 text-destructive";
                                  else cls = "border-border opacity-60";
                                } else if (selected) {
                                  cls = "border-pop/50 bg-pop/10";
                                }
                                return (
                                  <button
                                    key={option.id}
                                    disabled={completed || locked}
                                    onClick={() =>
                                      mode === "learning"
                                        ? answerLearningMcq(question, option.id)
                                        : setAnswers((current) => ({
                                            ...current,
                                            [question.id]: option.id,
                                          }))
                                    }
                                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${cls}`}
                                  >
                                    <span className="shrink-0 font-semibold">{option.id}</span>
                                    <span className="min-w-0 flex-1 break-words">{option.text}</span>
                                    {showFeedback && isCorrectOption && (
                                      <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-leaf" />
                                    )}
                                    {showFeedback && selected && !isCorrectOption && (
                                      <XCircle className="ml-auto h-4 w-4 shrink-0 text-destructive" />
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <>
                              <textarea
                                value={answers[question.id] ?? ""}
                                disabled={completed}
                                onChange={(event) =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [question.id]: event.target.value,
                                  }))
                                }
                                placeholder="Write your answer"
                                className="mt-3 min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40 disabled:opacity-70"
                              />
                              {mode === "learning" && !grade && (
                                <button
                                  onClick={() =>
                                    setRevealedEssays((current) => ({
                                      ...current,
                                      [question.id]: !current[question.id],
                                    }))
                                  }
                                  className="mt-2 text-xs font-semibold text-pop transition-colors hover:text-pop/80"
                                >
                                  {revealedEssays[question.id]
                                    ? "Hide model answer"
                                    : "Reveal model answer"}
                                </button>
                              )}
                            </>
                          )}
                          {showFeedback && (
                            <AnswerFeedback question={question} grade={grade} />
                          )}
                        </div>
                      );
                    })}

                    {mode === "exam" ? (
                      <button
                        onClick={submitExam}
                        disabled={reviewLoading}
                        className="btn-pop inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                      >
                        {reviewLoading ? (
                          <LoadingDots />
                        ) : (
                          <GraduationCap className="h-4 w-4" />
                        )}
                        Submit quiz
                      </button>
                    ) : !completed ? (
                      <button
                        onClick={finishLearning}
                        disabled={!learningReady || reviewLoading}
                        className="btn-pop inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                      >
                        {reviewLoading ? (
                          <LoadingDots />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {learningReady ? "Finish & save" : "Answer all to finish"}
                      </button>
                    ) : (
                      <div className="rounded-2xl border border-pop/25 bg-pop/[0.06] p-4 text-center">
                        <div className="text-sm font-semibold">Session saved</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {correctCount}/{totalQuestions} correct · {formatDuration(elapsedSec)}
                        </p>
                        <button
                          onClick={backToTopics}
                          className="btn-pop mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                        >
                          Back to topics
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Essay-only sessions keep the original AI-graded review flow. */}
            {!isFlashcards && !usesModes && (
              <div className="space-y-4">
                {questions.map((question, index) => (
                  <div
                    key={question.id}
                    className="rounded-2xl border border-border bg-background/40 p-3 sm:p-4"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {question.question_type} - {question.difficulty} - {index + 1}
                    </div>
                    <p className="text-sm font-medium break-words">{question.prompt}</p>
                    {Array.isArray(question.source_refs) && question.source_refs.length > 0 ? (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-pop/5 px-2.5 py-1.5 text-xs text-muted-foreground break-words">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
                        <span className="min-w-0">Source: {sourceText(question.source_refs)}</span>
                      </p>
                    ) : (
                      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-600 break-words dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                          Not found in your material - answer with caution.
                        </span>
                      </p>
                    )}
                    {question.question_type === "mcq" ? (
                      <div className="mt-3 space-y-2">
                        {(question.options ?? []).map((option) => (
                          <button
                            key={option.id}
                            disabled={completed}
                            onClick={() =>
                              setAnswers((current) => ({ ...current, [question.id]: option.id }))
                            }
                            className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default disabled:opacity-70 ${
                              answers[question.id] === option.id
                                ? "border-pop/50 bg-pop/10"
                                : "border-border hover:border-pop/30 hover:bg-foreground/[0.02]"
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
                        disabled={completed}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        placeholder="Write your answer"
                        className="mt-3 min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-pop/50 focus:ring-2 focus:ring-pop/40 disabled:opacity-70"
                      />
                    )}
                  </div>
                ))}

                {!completed && (
                  <button
                    onClick={submitPractice}
                    disabled={reviewLoading}
                    className="btn-pop inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                  >
                    {reviewLoading ? (
                      <LoadingDots />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Submit and review
                  </button>
                )}

                {review && (
                  <div className="rounded-2xl border border-pop/25 bg-pop/[0.06] p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold">Review</span>
                      <span className="text-sm font-semibold">
                        {Math.round(Number(review.grading.percentage ?? 0))}%
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {review.coaching}
                    </p>
                    <button
                      onClick={backToTopics}
                      className="btn-pop mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                    >
                      Back to topics
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`h-2 overflow-hidden rounded-full bg-foreground/[0.07] ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-pop transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
