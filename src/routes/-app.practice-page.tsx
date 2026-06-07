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
  Loader2,
  Play,
  Trophy,
  XCircle,
} from "lucide-react";
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
  if (!optionId) return "—";
  const match = (question.options ?? []).find((option) => option.id === optionId);
  return match ? `${match.id}. ${match.text}` : optionId;
}

function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function SourceOrWarn({ question }: { question: QuestionRow }) {
  if (Array.isArray(question.source_refs) && question.source_refs.length > 0) {
    return (
      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground break-words">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="min-w-0">Source: {sourceText(question.source_refs)}</span>
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs font-medium text-amber-600 break-words dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">Not found in your material — answer with caution.</span>
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
    <div className="mt-3 space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm">
      <p className="flex items-start gap-1.5">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
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
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
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
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary"
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
  const [practiceLoading, setPracticeLoading] = useState(false);

  // Learning/Exam modes only apply to question sets that contain MCQs.
  const supportsModes = questionType === "mcq" || questionType === "mixed";

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
      setPlanLoading(true);
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
    })();
    return () => {
      active = false;
    };
  }, [user, planId]);

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
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 overflow-x-hidden">
        <header className="flex flex-col gap-2">
          <Link
            to="/app/studybody"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to My Coach
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary">
                <Brain className="h-4 w-4" />
                Practice
              </div>
              <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl">
                {plan?.title || "Roadmap practice"}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {plan ? `${topics.length} topics - ${plan.source_type}` : "Loading roadmap…"}
              </p>
            </div>
            {plan && topics.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                <Trophy className="h-4 w-4 text-primary" />
                {masteredCount}/{topics.length} mastered
              </div>
            )}
          </div>
        </header>

        {schemaMissing && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm">
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
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <section className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            {/* Topics */}
            <div className="luxury-panel rounded-lg p-4">
              <div className="mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Pick a topic</h2>
              </div>
              <div className="space-y-3">
                {topics.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                    This roadmap has no topics yet.
                  </div>
                ) : (
                  topics.map((topic, index) => (
                    <button
                      key={topic.id}
                      onClick={() => setSelectedTopicId(topic.id)}
                      className={`w-full min-w-0 rounded-lg border p-3 text-left transition-colors ${
                        selectedTopicId === topic.id
                          ? "border-primary/50 bg-primary/10"
                          : "border-border bg-surface/25 hover:border-primary/30"
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
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
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
                        <span className="shrink-0 text-xs font-semibold">
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
            <aside className="luxury-panel min-w-0 rounded-lg p-4">
              <div className="mb-4 flex items-center gap-2">
                <Brain className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Set up practice</h2>
              </div>

              {activeTopic ? (
                <>
                  <div className="rounded-lg border border-border bg-surface/30 p-3">
                    <div className="text-sm font-semibold">{activeTopic.title}</div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeTopic.summary}</p>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-1.5 sm:gap-2">
                    {(["mcq", "essay", "mixed", "flashcard"] as StudyQuestionType[]).map((type) => (
                      <button
                        key={type}
                        onClick={() => changeType(type)}
                        className={`flex items-center justify-center gap-1 rounded-lg border px-2 py-2 text-xs font-medium sm:text-sm ${
                          questionType === type
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border hover:border-primary/30"
                        }`}
                      >
                        {type === "flashcard" && <Layers className="h-3.5 w-3.5" />}
                        {TYPE_LABEL[type]}
                      </button>
                    ))}
                  </div>

                  {supportsModes && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Mode</div>
                      <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                        {(
                          [
                            {
                              value: "learning" as const,
                              label: "Learning",
                              hint: "Instant feedback",
                              icon: Brain,
                            },
                            {
                              value: "exam" as const,
                              label: "Exam",
                              hint: "Graded at end",
                              icon: GraduationCap,
                            },
                          ]
                        ).map((option) => {
                          const Icon = option.icon;
                          const active = practiceMode === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => setPracticeMode(option.value)}
                              className={`flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left ${
                                active
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border hover:border-primary/30"
                              }`}
                            >
                              <span className="flex items-center gap-1.5 text-sm font-semibold">
                                <Icon className="h-3.5 w-3.5" />
                                {option.label}
                              </span>
                              <span className="text-[11px] text-muted-foreground">{option.hint}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="mt-3">
                    {questionType === "mixed" ? (
                      <>
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
                                className={`rounded-lg border px-2 py-2 text-xs font-medium ${
                                  selected
                                    ? "border-primary/40 bg-primary/10 text-primary"
                                    : "border-border hover:border-primary/30"
                                }`}
                              >
                                {preset.mcq} MCQ + {preset.essay} Essay
                              </button>
                            );
                          })}
                        </div>
                        <button
                          onClick={() => setCustomMode(true)}
                          className={`mt-2 w-full rounded-lg border px-2 py-2 text-sm font-medium ${
                            customMode
                              ? "border-primary/40 bg-primary/10 text-primary"
                              : "border-border hover:border-primary/30"
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
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
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
                                className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                              />
                            </label>
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
                          {COUNT_OPTIONS[questionType].map((option) => (
                            <button
                              key={option}
                              onClick={() => {
                                setCustomMode(false);
                                setCount(option);
                              }}
                              className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                                !customMode && count === option
                                  ? "border-primary/40 bg-primary/10 text-primary"
                                  : "border-border hover:border-primary/30"
                              }`}
                            >
                              {option}
                            </button>
                          ))}
                          <button
                            onClick={() => setCustomMode(true)}
                            className={`rounded-lg border px-2 py-2 text-sm font-medium ${
                              customMode
                                ? "border-primary/40 bg-primary/10 text-primary"
                                : "border-border hover:border-primary/30"
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
                            className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                          />
                        )}
                      </>
                    )}
                  </div>

                  <button
                    onClick={start}
                    disabled={practiceLoading}
                    className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {practiceLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : questionType === "flashcard" ? (
                      <Layers className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    {practiceLoading
                      ? "Building your set…"
                      : questionType === "flashcard"
                        ? "Start flash cards"
                        : "Start practice"}
                  </button>
                  {practiceLoading && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      Larger sets take a little longer to build from your files.
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
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
          // Reopened a finished set — rebuild answers + grades from saved rows.
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
        } else if (modeSession) {
          // Fresh attempt — start the timer used by Exam mode.
          setStartedAt(Date.now());
        }
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [user, sessionId]);

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

      setReview(result);
      setCompleted(true);
      toast.success(
        mastered ? `${topicTitle || "Topic"} mastered!` : "Practice reviewed — keep going.",
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
      toast.success(result?.mastered ? `${topicTitle || "Topic"} mastered!` : "Saved — nice work.");
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
      await finalizeTopicMastery(session.topic_id, percentage);
      setCompleted(true);
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

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-x-hidden">
        <header className="flex flex-col gap-2">
          <button
            onClick={backToTopics}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to topics
          </button>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            {isFlashcards ? <Layers className="h-4 w-4" /> : <Brain className="h-4 w-4" />}
            {isFlashcards ? "Flash cards" : "Practice"}
          </div>
          <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl">
            {topicTitle || "Practice session"}
          </h1>
        </header>

        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <div className="luxury-panel rounded-lg p-4 sm:p-5">
            {/* Flashcards */}
            {isFlashcards && !fcDone && currentCard && (
              <div>
                <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    Card {fcIndex + 1} of {flashcards.length}
                  </span>
                  <span>{Object.keys(fcRatings).length} rated</span>
                </div>
                <div className="flex min-h-[280px] flex-col rounded-lg border border-border bg-background/50 p-5">
                  <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {fcFlipped ? "Answer" : "Question"}
                  </div>
                  <p className="flex flex-1 items-center justify-center break-words px-1 py-4 text-center text-xl font-semibold leading-snug sm:text-2xl">
                    {fcFlipped ? currentCard.back : currentCard.front}
                  </p>
                  {fcFlipped &&
                    Array.isArray(currentCard.source_refs) &&
                    currentCard.source_refs.length > 0 && (
                      <p className="mt-3 flex items-start gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground break-words">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0">
                          Source: {sourceText(currentCard.source_refs)}
                        </span>
                      </p>
                    )}
                </div>
                {!fcFlipped ? (
                  <button
                    onClick={() => setFcFlipped(true)}
                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-semibold text-primary"
                  >
                    Show answer
                  </button>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      onClick={() => rateCard("missed")}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-semibold text-destructive"
                    >
                      Missed
                    </button>
                    <button
                      onClick={() => rateCard("got_it")}
                      className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                    >
                      Got it
                    </button>
                  </div>
                )}
              </div>
            )}

            {isFlashcards && fcDone && fcResult !== null && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
                <div className="text-sm font-semibold">Flash cards complete</div>
                <div className="mt-1 font-display text-4xl font-light">{fcResult}%</div>
                <p className="mt-1 text-sm text-muted-foreground">marked “got it”</p>
                <button
                  onClick={backToTopics}
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
                >
                  Back to topics
                </button>
              </div>
            )}

            {/* MCQ / Mixed sessions: Learning (instant feedback) or Exam (graded at end) */}
            {usesModes && (
              <div className="space-y-4">
                <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface/30 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <span className="flex items-center gap-1.5 font-semibold">
                    {mode === "exam" ? (
                      <GraduationCap className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <Brain className="h-3.5 w-3.5 text-primary" />
                    )}
                    {mode === "exam" ? "Exam mode" : "Learning mode"}
                  </span>
                  <span className="text-muted-foreground">
                    {mode === "exam"
                      ? "Answers are graded when you submit"
                      : "Instant feedback after each answer"}
                  </span>
                </div>

                {mode === "exam" && examSubmitted ? (
                  /* ---- Exam results ---- */
                  <div className="space-y-4">
                    <div className="rounded-lg border border-primary/20 bg-primary/5 p-5 text-center">
                      <div className="text-sm font-semibold">Quiz complete</div>
                      <div className="mt-1 font-display text-4xl font-light">
                        {scorePercentage}%
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                        <div className="rounded-lg border border-border bg-background/50 p-2">
                          <div className="font-display text-xl font-light">
                            {correctCount}/{totalQuestions}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Score</div>
                        </div>
                        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2 text-emerald-700 dark:text-emerald-300">
                          <div className="font-display text-xl font-light">{correctCount}</div>
                          <div className="text-[11px] opacity-80">Correct</div>
                        </div>
                        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-2 text-destructive">
                          <div className="font-display text-xl font-light">{incorrectCount}</div>
                          <div className="text-[11px] opacity-80">Incorrect</div>
                        </div>
                        <div className="rounded-lg border border-border bg-background/50 p-2">
                          <div className="flex items-center justify-center gap-1 font-display text-xl font-light">
                            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatDuration(elapsedSec)}
                          </div>
                          <div className="text-[11px] text-muted-foreground">Time</div>
                        </div>
                      </div>
                    </div>

                    {review?.coaching ? (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
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
                              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 sm:p-4"
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
                                    : answers[question.id] || "—"}
                                </span>
                              </p>
                              <AnswerFeedback question={question} grade={grades[question.id]} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        Perfect score — every question correct. 🎉
                      </div>
                    )}

                    <button
                      onClick={backToTopics}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
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
                          className="rounded-lg border border-border bg-background/50 p-3 sm:p-4"
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
                                let cls = "border-border hover:border-primary/30";
                                if (showFeedback) {
                                  if (isCorrectOption)
                                    cls =
                                      "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
                                  else if (selected)
                                    cls = "border-destructive/60 bg-destructive/10 text-destructive";
                                  else cls = "border-border opacity-60";
                                } else if (selected) {
                                  cls = "border-primary/50 bg-primary/10";
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
                                    className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors disabled:cursor-default ${cls}`}
                                  >
                                    <span className="shrink-0 font-semibold">{option.id}</span>
                                    <span className="min-w-0 flex-1 break-words">{option.text}</span>
                                    {showFeedback && isCorrectOption && (
                                      <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-600" />
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
                                className="mt-3 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                              />
                              {mode === "learning" && !grade && (
                                <button
                                  onClick={() =>
                                    setRevealedEssays((current) => ({
                                      ...current,
                                      [question.id]: !current[question.id],
                                    }))
                                  }
                                  className="mt-2 text-xs font-semibold text-primary"
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
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {reviewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <GraduationCap className="h-4 w-4" />
                        )}
                        Submit quiz
                      </button>
                    ) : !completed ? (
                      <button
                        onClick={finishLearning}
                        disabled={!learningReady || reviewLoading}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                      >
                        {reviewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                        {learningReady ? "Finish & save" : "Answer all to finish"}
                      </button>
                    ) : (
                      <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-center">
                        <div className="text-sm font-semibold">Session saved</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {correctCount}/{totalQuestions} correct · {formatDuration(elapsedSec)}
                        </p>
                        <button
                          onClick={backToTopics}
                          className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
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
                    className="rounded-lg border border-border bg-background/50 p-3 sm:p-4"
                  >
                    <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {question.question_type} - {question.difficulty} - {index + 1}
                    </div>
                    <p className="text-sm font-medium break-words">{question.prompt}</p>
                    {Array.isArray(question.source_refs) && question.source_refs.length > 0 ? (
                      <p className="mt-2 flex items-start gap-1.5 rounded-md bg-primary/5 px-2 py-1.5 text-xs text-muted-foreground break-words">
                        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0">Source: {sourceText(question.source_refs)}</span>
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
                            disabled={completed}
                            onClick={() =>
                              setAnswers((current) => ({ ...current, [question.id]: option.id }))
                            }
                            className={`flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm disabled:opacity-70 ${
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
                        disabled={completed}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [question.id]: event.target.value,
                          }))
                        }
                        placeholder="Write your answer"
                        className="mt-3 min-h-28 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-70"
                      />
                    )}
                  </div>
                ))}

                {!completed && (
                  <button
                    onClick={submitPractice}
                    disabled={reviewLoading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {reviewLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Submit and review
                  </button>
                )}

                {review && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
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
                      className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-elevated"
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
