import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileText,
  GraduationCap,
  Layers,
  Play,
  Swords,
  Timer,
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
import {
  recordGamificationEvent,
  recordRoadmapCompletedOnce,
  recordWeekendMissionIfDue,
} from "@/lib/gamification";
import {
  formatClock,
  readTimedChallenge,
  speedBonusMaxSeconds,
  type TimedChallenge,
} from "@/lib/timed-challenge";
import { TimerPicker } from "@/components/timer-picker";
import { chosenTimerSeconds, timerChoiceBlocker, useTimerChoice } from "@/lib/use-timer-choice";
import {
  listChallenges,
  submitChallengeForSession,
  formatDuration as formatChallengeDuration,
  type ChallengeSummary,
} from "@/lib/social";
import {
  gradeMcqOnServer,
  loadQuestionsWithheld,
  MCQ_GRADING_APPLIED,
  type McqGrade,
} from "@/lib/mcq-grading";

type PracticeSearch = { plan?: string; session?: string; mode?: PracticeMode };

type PracticeMode = "learning" | "exam";

type Flashcard = {
  id: string;
  front: string;
  back: string;
  source_refs: unknown[];
};

// Grade for a single question.
//
// With MCQ_GRADING_APPLIED, an MCQ's grade is decided by public.study_mcq_grade()
// from study_questions.correct_answer, which the browser has not been sent - the
// key only arrives back WITH the grade, at the moment the answer is submitted.
// Before the migration is applied it is still computed on-device against the
// stored key, exactly as it always was. Essays carry the AI grade either way.
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

// The source line under a question, or the warning that stands in for it.
//
// `sourcesStripped` is for a challenge set. challenge_begin() copies the
// challenger's questions to the opponent with source_refs deliberately emptied -
// which file a student has uploaded is not something to hand to another student
// as a side effect of a quiz - so EVERY question in a received challenge has no
// refs. The warning would then fire on all of them and say something false:
// these questions do come from real material, just not from this student's.
// Nothing is shown instead; the set already announces itself as a friend's.
function SourceOrWarn({
  question,
  sourcesStripped,
}: {
  question: QuestionRow;
  sourcesStripped?: boolean;
}) {
  if (Array.isArray(question.source_refs) && question.source_refs.length > 0) {
    return (
      <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-pop/5 px-2.5 py-1.5 text-xs text-muted-foreground break-words">
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
        <span className="min-w-0">Source: {sourceText(question.source_refs)}</span>
      </p>
    );
  }
  if (sourcesStripped) return null;
  return (
    <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-600 break-words dark:text-amber-400">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">Not found in your material - answer with caution.</span>
    </p>
  );
}

// The post-answer panel: correct answer, explanation, source, and (for essays)
// the AI feedback. Used inline in Learning mode and in the Exam review list.
function AnswerFeedback({
  question,
  grade,
  sourcesStripped,
}: {
  question: QuestionRow;
  grade?: Grade;
  sourcesStripped?: boolean;
}) {
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
      {/* Skipped on a challenge copy: with source_refs stripped, sourceText()
          falls back to "from your uploaded material", which is the one thing it
          definitely is not - the file belongs to whoever sent the challenge. */}
      {sourcesStripped ? null : (
        <p className="flex items-start gap-1.5 break-words text-xs text-muted-foreground">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pop" />
          <span className="min-w-0">
            <span className="font-semibold">Source: </span>
            {sourceText(question.source_refs)}
          </span>
        </p>
      )}
      {grade?.feedback ? (
        <p className="break-words text-muted-foreground">
          <span className="font-semibold text-foreground">Feedback: </span>
          {grade.feedback}
        </p>
      ) : null}
    </div>
  );
}

// The verdict on a friend challenge, shown on the results screen the moment the
// set is submitted.
//
// Before this, finishing a received challenge told you your own score and
// nothing else - whether you had actually won it was a separate trip to Friends.
// Every branch below is read from the server's decision (challenge_list_mine's
// `outcome`), never recomputed on the device, and a draw is named as a draw
// rather than being left as the absence of a win.
function ChallengeResultCard({ summary }: { summary: ChallengeSummary }) {
  const opponent = summary.opponent_username
    ? `@${summary.opponent_username}`
    : summary.opponent_name;
  const tone =
    summary.outcome === "won"
      ? "border-leaf/40 bg-leaf/10 text-leaf"
      : summary.outcome === "lost"
        ? "border-destructive/40 bg-destructive/5 text-destructive"
        : // A draw. Deliberately neutral rather than copper: --pop and --leaf
          // are the same hex in the light theme, where a copper badge would be
          // indistinguishable from the one that says you won.
          "border-border bg-foreground/[0.08] text-foreground";
  const verdict =
    summary.outcome === "won"
      ? "You won"
      : summary.outcome === "lost"
        ? "You lost"
        : summary.outcome === "draw"
          ? "It's a draw"
          : null;
  // Level on score but not a draw means the clock separated you, which is the
  // one result students read as a mistake unless it says so out loud.
  const decidedOnTime =
    summary.outcome != null &&
    summary.outcome !== "draw" &&
    summary.my_score != null &&
    summary.their_score != null &&
    summary.my_score === summary.their_score;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <Swords className="h-4 w-4 text-pop" />
          Challenge from {opponent}
        </span>
        <Link
          to="/app/friends"
          className="shrink-0 text-xs font-semibold text-pop transition-colors hover:text-pop/80"
        >
          All results
        </Link>
      </div>

      <div className="mt-3 flex items-center justify-center gap-5">
        <div className="text-center">
          <div className="font-display text-3xl font-light">{summary.my_score ?? 0}</div>
          <div className="mt-0.5 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            You
          </div>
        </div>
        <div className="text-xs text-muted-foreground">of {summary.question_count}</div>
        <div className="text-center">
          <div
            className={`font-display text-3xl font-light ${summary.their_finished ? "" : "text-muted-foreground"}`}
          >
            {summary.their_finished ? (summary.their_score ?? 0) : "—"}
          </div>
          <div className="mt-0.5 max-w-28 truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
            {opponent}
          </div>
        </div>
      </div>

      {verdict ? (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${tone}`}>
            {verdict}
          </span>
          <p className="text-center text-xs text-muted-foreground">
            {decidedOnTime
              ? `Level on score - the faster finish decided it (${formatChallengeDuration(summary.my_duration_ms)} to ${formatChallengeDuration(summary.their_duration_ms)}).`
              : `${formatChallengeDuration(summary.my_duration_ms)} to ${formatChallengeDuration(summary.their_duration_ms)}.`}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Your answers are in. {opponent} hasn&apos;t played yet - their score shows once they
          finish, and the result lands in Friends.
        </p>
      )}
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
            Back to PQ
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
  // Whether the folded settings row is open. Purely presentational -
  // every value inside it keeps its default whether it is shown or not.
  const [showMoreOptions, setShowMoreOptions] = useState(false);
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
  // The timer rides on the same sets that already keep an elapsed clock, so
  // flashcards and essay-only sets are untouched by it.
  const supportsTimer = supportsModes;

  // What the folded row says when it is closed. It names the settings the
  // student would otherwise have to open it to check, so the fold costs them no
  // information - only the space the three rows used to take.
  const optionsSummary =
    [
      supportsModes ? (practiceMode === "learning" ? "Learning" : "Exam") : null,
      supportsDifficulty
        ? difficulty === "easy"
          ? "Easy"
          : difficulty === "medium"
            ? "Medium"
            : "Hard"
        : null,
    ]
      .filter(Boolean)
      .join(" \u00b7 ") || "Options";

  const requestedTotal = questionType === "mixed" ? mixedMcq + mixedEssay : count;
  // "Race the clock" — off by default, and off means the set is created with no
  // timer key at all, i.e. byte-for-byte the old behaviour. The hook is called
  // unconditionally; only the picker's rendering depends on `supportsTimer`.
  const timer = useTimerChoice(requestedTotal);

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
      toast.error(
        "Practice Questions tables are missing in Supabase. Apply the StudyBody migration first.",
      );
      return;
    }
    const ids = plan.source_document_ids ?? [];
    if (!ids.length) {
      toast.error("This roadmap has no source files to practice from.");
      return;
    }
    // Timer on but nothing usable typed: say so rather than quietly building an
    // untimed set out of a choice the student thought they had made.
    const timerProblem = supportsTimer ? timerChoiceBlocker(timer) : null;
    if (timerProblem) {
      toast.error(timerProblem);
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
      // Only written when the student opted in, so an untimed set carries no
      // timer key and every older set keeps reading as untimed.
      const challenge = supportsTimer ? chosenTimerSeconds(timer) || null : null;
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
          // Persist the mode (and the clock) up front so a resumed set keeps
          // Learning/Exam and its timer even before the first answer is autosaved.
          feedback: {
            ...(sessionMode ? { mode: sessionMode } : {}),
            ...(challenge ? { timer_seconds: challenge } : {}),
          },
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
            Back to PQ
          </Link>
          <PageHeader
            eyebrow="PQ"
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
              Practice Questions database tables are missing
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
                        navigate({
                          to: "/app/practice",
                          search: { plan: planId, session: resumable.id },
                        })
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
                            {TYPE_LABEL[resumable.questionType]} · {resumable.answered}/
                            {resumable.total} answered - no new questions
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
                      getIcon={(type) =>
                        type === "flashcard" ? <Layers className="h-3.5 w-3.5" /> : null
                      }
                      className="h-10"
                    />
                  </div>

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

                  {/* Mode, difficulty and the timer all have working defaults
                      and most students never touch them, but they used to sit
                      between "question type" and "how many" as three more
                      labelled rows - which pushed Start below the fold in a
                      360px column. Folded here, with the current choices shown
                      on the toggle, so nothing is hidden, only quiet. */}
                  {(supportsModes || supportsDifficulty || supportsTimer) && (
                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => setShowMoreOptions((value) => !value)}
                        aria-expanded={showMoreOptions}
                        className="flex w-full items-center justify-between gap-2 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:border-pop/30"
                      >
                        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
                          {optionsSummary}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                            showMoreOptions ? "rotate-180" : ""
                          }`}
                        />
                      </button>

                      {showMoreOptions && (
                        <div className="mt-2 space-y-3">
                          {supportsModes && (
                            <div>
                              <div className="mb-1.5 text-xs font-medium text-muted-foreground">
                                Mode
                              </div>
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
                            </div>
                          )}

                          {supportsDifficulty && (
                            <div>
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
                            </div>
                          )}

                          {supportsTimer && <TimerPicker choice={timer} />}
                        </div>
                      )}
                    </div>
                  )}

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
  // Learning-mode MCQs whose answer is with the server and whose grade has not
  // come back yet. Without this the option buttons stay live across the round
  // trip and a second tap answers the question twice.
  const [gradingIds, setGradingIds] = useState<Record<string, true>>({});
  const [examSubmitted, setExamSubmitted] = useState(false);
  const [revealedEssays, setRevealedEssays] = useState<Record<string, boolean>>({});
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedSec, setElapsedSec] = useState<number | null>(null);
  // Drives the countdown chip only; the bonus is settled from the real elapsed
  // time on submit, so a backgrounded tab cannot be used to buy time.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timeUpNotified, setTimeUpNotified] = useState(false);
  // The server's verdict on this set, once it is finished and if it is half of a
  // friend challenge. Null for an ordinary practice set and until it is fetched.
  const [challengeResult, setChallengeResult] = useState<ChallengeSummary | null>(null);

  const [fcIndex, setFcIndex] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcRatings, setFcRatings] = useState<Record<string, "got_it" | "missed">>({});
  const [fcDone, setFcDone] = useState(false);
  const [fcResult, setFcResult] = useState<number | null>(null);

  const isFlashcards = session?.question_type === "flashcard";
  const usesModes = session?.question_type === "mcq" || session?.question_type === "mixed";
  // Null for every set created without the timer, which is every set that
  // existed before this feature and every set where the student left it off.
  const challenge: TimedChallenge | null = readTimedChallenge(session?.feedback);
  const hasEssays = questions.some((question) => question.question_type === "essay");
  // Mode resolves from the persisted session first (so reopening a completed set
  // keeps its mode), then the URL param, defaulting to learning.
  const mode: PracticeMode =
    (session?.feedback as { mode?: PracticeMode } | null)?.mode ?? modeParam ?? "learning";
  // Set when this session is a copy made by challenge_begin() - i.e. somebody
  // sent this set. Null for anything built from the student's own material, so
  // every challenge-only behaviour below is off for ordinary practice.
  const challengeId = (session?.feedback as { challenge_id?: string } | null)?.challenge_id ?? null;

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data: sessionData, error: sessionErr } = await db
        .from("study_sessions")
        .select(
          "id, plan_id, topic_id, question_type, score, requested_count, total_questions, status, feedback",
        )
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

      // The question read. With the withholding migration applied this goes
      // through study_session_questions(), which returns correct_answer as ""
      // and explanation as null for any MCQ this student has not yet submitted
      // an answer to - so the key for an unanswered question never reaches the
      // browser at all, rather than reaching it and being politely ignored.
      // Essays and flashcards come back unchanged: an essay's "key" is its model
      // answer, which Learning mode deliberately offers behind a button and the
      // AI grader needs sent back to it, and a flashcard's is the back of the
      // card. Neither can be compared against, so neither decides a contest.
      const [withheld, { data: topicData }] = await Promise.all([
        loadQuestionsWithheld(sessionId),
        db.from("study_topics").select("title").eq("id", sessionRow.topic_id).single(),
      ]);
      if (!active) return;

      let rows: QuestionRow[];
      if (withheld) {
        rows = withheld;
      } else {
        const { data: questionData } = await db
          .from("study_questions")
          .select(
            "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
          )
          .eq("session_id", sessionId)
          .order("position", { ascending: true });
        if (!active) return;
        rows = (questionData as QuestionRow[]) ?? [];
      }
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
          const fb = sessionRow.feedback as {
            time_taken_seconds?: number;
            review?: StudyReview;
          } | null;
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

            // Resume-in-place, with the keys withheld: re-submit the MCQs this
            // sitting has already answered so the server hands their keys back.
            //
            // It matters for one case in particular. A Learning-mode set that
            // was started BEFORE this migration has draftGrades but no
            // study_answers rows, because the old client only wrote answers on
            // finish. Without this the student would come back to questions the
            // page shows as graded, with no correct option highlighted and no
            // explanation - the drafts say "answered", the server says "not
            // answered", and the server is the one holding the key.
            //
            // For a set started after the migration it is a no-op that costs one
            // round trip: study_mcq_grade() replaces rather than appends, and
            // re-grading the same answer against the same key cannot change it.
            const draftMcq: Record<string, string> = {};
            for (const row of rows) {
              if (row.question_type !== "mcq") continue;
              const answer = fb?.draftAnswers?.[row.id];
              if (typeof answer === "string" && answer.trim()) draftMcq[row.id] = answer;
            }
            if (MCQ_GRADING_APPLIED && Object.keys(draftMcq).length > 0) {
              try {
                const results = await gradeMcqOnServer(sessionId, draftMcq);
                if (!active) return;
                if (results?.length) {
                  const keys = new Map(results.map((result) => [result.question_id, result]));
                  setQuestions((current) =>
                    current.map((question) => {
                      const key = keys.get(question.id);
                      return key
                        ? {
                            ...question,
                            correct_answer: key.correct_answer,
                            explanation: key.explanation,
                          }
                        : question;
                    }),
                  );
                  setGrades((current) => {
                    const next = { ...current };
                    for (const result of results) {
                      next[result.question_id] = {
                        is_correct: result.is_correct,
                        score: result.is_correct ? 1 : 0,
                      };
                    }
                    return next;
                  });
                }
              } catch {
                // The set is still playable; only the already-answered questions
                // show without their key until the next submit.
              }
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

  // The countdown. Only runs while a timed set is actually open, so an untimed
  // or finished set never schedules an interval. Recomputed from the wall clock
  // on every tick rather than decremented, so a throttled background tab shows
  // the truth when it comes back rather than however many ticks it missed.
  const challengeSeconds = challenge?.seconds ?? 0;
  useEffect(() => {
    if (!challengeSeconds || completed || examSubmitted || startedAt == null) {
      setSecondsLeft(null);
      return;
    }
    const compute = () =>
      setSecondsLeft(Math.max(0, challengeSeconds - Math.round((Date.now() - startedAt) / 1000)));
    compute();
    const id = window.setInterval(compute, 1000);
    return () => window.clearInterval(id);
  }, [challengeSeconds, completed, examSubmitted, startedAt]);

  useEffect(() => {
    if (secondsLeft !== 0 || timeUpNotified || completed) return;
    setTimeUpNotified(true);
    // Deliberately not a submit. See the note at the top of lib/timed-challenge.ts.
    toast.message("Time's up — the bonus is gone, but finish the set at your own pace.");
  }, [secondsLeft, timeUpNotified, completed]);

  // The challenge verdict, fetched once this sitting is finished - both when a
  // set is submitted here (persistResults flips `completed` after it has stamped
  // the finish time) and when a finished challenge set is reopened later.
  //
  // listChallenges() sweeps before it reads, which is what settles a contest
  // whose second player has just finished, so this is the server's decision and
  // not a guess made on the device. It is allowed to fail quietly: the same
  // result is always recoverable from Friends, and practice must not break
  // because a social read did.
  useEffect(() => {
    if (!challengeId || !completed) return;
    let active = true;
    (async () => {
      try {
        const rows = await listChallenges();
        if (!active) return;
        setChallengeResult(rows.find((row) => row.id === challengeId) ?? null);
      } catch (err) {
        console.warn("could not load the challenge result", err);
      }
    })();
    return () => {
      active = false;
    };
  }, [challengeId, completed]);

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
      recordWeekendMissionIfDue(user.id);
      if (mastered) await awardRoadmapIfComplete(user.id, session.plan_id);

      // Keep the per-question grades in state so each answer can show its model
      // answer, explanation, and AI feedback in the review below.
      const gradeMap: Record<string, Grade> = {};
      questions.forEach((question, index) => {
        const grade =
          gradingAnswers.find((item) => item.question_id === question.id) ??
          gradingAnswers[index] ??
          {};
        gradeMap[question.id] = {
          is_correct: grade.is_correct ?? null,
          score: grade.score ?? null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });
      setGrades(gradeMap);

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

  // The pre-migration path: compare on-device against a key the browser was
  // sent. Kept, unchanged, because MCQ_GRADING_APPLIED is false until the owner
  // applies 20260810120000_mcq_server_grading.sql by hand, and a page that
  // called a function the database does not have would fail outright.
  const gradeMcq = (question: QuestionRow, answer: string | undefined): Grade => {
    const correct = (answer ?? "") === question.correct_answer;
    return { is_correct: correct, score: correct ? 1 : 0 };
  };

  // Fold what the server returned back into the page: the grade, and the key +
  // explanation it released along with it. Merging the key into `questions`
  // rather than into a second map is what keeps AnswerFeedback and the option
  // colouring below reading `question.correct_answer` exactly as they did.
  const applyServerGrades = (results: McqGrade[]): Record<string, Grade> => {
    const map: Record<string, Grade> = {};
    for (const result of results) {
      map[result.question_id] = { is_correct: result.is_correct, score: result.is_correct ? 1 : 0 };
    }
    const keys = new Map(results.map((result) => [result.question_id, result]));
    setQuestions((current) =>
      current.map((question) => {
        const key = keys.get(question.id);
        return key
          ? { ...question, correct_answer: key.correct_answer, explanation: key.explanation }
          : question;
      }),
    );
    return map;
  };

  // Learning mode: lock the question and grade it the instant an option is picked.
  const answerLearningMcq = async (question: QuestionRow, optionId: string) => {
    if (completed || grades[question.id] || gradingIds[question.id]) return;
    setAnswers((current) => ({ ...current, [question.id]: optionId }));

    if (!MCQ_GRADING_APPLIED) {
      setGrades((current) => ({ ...current, [question.id]: gradeMcq(question, optionId) }));
      return;
    }

    setGradingIds((current) => ({ ...current, [question.id]: true }));
    try {
      const results = await gradeMcqOnServer(session?.id ?? sessionId, {
        [question.id]: optionId,
      });
      const map = applyServerGrades(results ?? []);
      const grade = map[question.id];
      if (!grade) throw new Error("That answer was not graded.");
      setGrades((current) => ({ ...current, [question.id]: grade }));
    } catch (err) {
      // Leave the question unanswered rather than showing a grade nobody
      // computed: the selection is rolled back so the student can pick again.
      setAnswers((current) => {
        const next = { ...current };
        delete next[question.id];
        return next;
      });
      toast.error(err instanceof Error ? err.message : "Could not grade that answer");
    } finally {
      setGradingIds((current) => {
        const next = { ...current };
        delete next[question.id];
        return next;
      });
    }
  };

  // MCQs are graded by the server (or, pre-migration, on-device against the
  // stored key); essays still need the AI.
  const buildGrades = async (): Promise<{
    map: Record<string, Grade>;
    review: StudyReview | null;
  }> => {
    let map: Record<string, Grade> = {};
    const mcqs = questions.filter((question) => question.question_type === "mcq");
    if (MCQ_GRADING_APPLIED && mcqs.length) {
      // One call for the whole set. Safe to re-send questions Learning mode has
      // already graded: study_mcq_grade() replaces rather than appends, so a
      // resubmit cannot leave two answer rows for one question.
      const submitted: Record<string, string> = {};
      for (const question of mcqs) {
        const answer = answers[question.id];
        if (answer) submitted[question.id] = answer;
      }
      map = applyServerGrades((await gradeMcqOnServer(session?.id ?? sessionId, submitted)) ?? []);
    } else {
      for (const question of mcqs) {
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
    // MCQ answer rows are written by study_mcq_grade() as part of grading, so
    // writing them again here would duplicate every one of them. Essays are
    // still written from here: their grade is the AI's, not a comparison, and
    // nothing server-side has recorded it.
    const answerRows = questions
      .filter((question) => !(MCQ_GRADING_APPLIED && question.question_type === "mcq"))
      .map((question) => {
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

    if (answerRows.length) await db.from("study_answers").insert(answerRows);
    await db
      .from("study_sessions")
      .update({
        status: "completed",
        score: percentage,
        // challenge_id is carried across rather than dropped. This write replaces
        // the whole feedback object, and challenge_begin() put that id there: it
        // is how a reopened set still knows it was a contest, which is what
        // suppresses the "not in your material" warning on a friend's questions
        // and what puts the result back on the screen.
        feedback: {
          ...(challengeId ? { challenge_id: challengeId } : {}),
          mode,
          time_taken_seconds: elapsed,
          review: review ?? null,
        },
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
    // If this set is half of a friend challenge, tell the server it is finished
    // NOW, so the tie-break time is stamped by the server's clock within a
    // second of the real finish. A device-reported duration is not merely
    // inaccurate — it is a number the device chooses, and duration decides every
    // drawn contest. No-ops for an ordinary practice set, and no-ops entirely
    // while SOCIAL_SCHEMA_APPLIED is false (it returns before any network call).
    // It never throws: practice must not fail because a social feature did, and
    // opening the challenge list recovers a result that did not land here.
    await submitChallengeForSession(session.id);

    // Flipped AFTER the stamp above, not before: it is what triggers the read of
    // the challenge verdict, and reading it first would ask the server who won
    // while this player's own finish time was still missing.
    setCompleted(true);

    const correct = questions.filter((question) => isGradeCorrect(map[question.id])).length;
    const failed = Math.max(0, questions.length - correct);
    if (correct) recordGamificationEvent(user.id, "coach_question_correct", { count: correct });
    if (failed) recordGamificationEvent(user.id, "coach_question_failed", { count: failed });
    recordGamificationEvent(user.id, "coach_session_completed");
    // Timed set: the opt-in award, plus the bonus for landing inside the budget.
    // `elapsed` is measured from the wall clock, not the countdown, so a paused
    // or throttled tab cannot claim a beat it did not earn.
    //
    // The second condition closes the hole a student-typed time would otherwise
    // open: without it, 90 minutes on a 5-question set beats the clock every
    // time and mints the daily +15 for free. The bonus only pays inside the
    // most generous budget the app itself would have suggested for this many
    // questions, which every preset already satisfies — so nothing changes for
    // a student who took a preset, and the picker says the rule out loud before
    // the set is built.
    if (challenge) {
      recordGamificationEvent(user.id, "coach_timed_challenge");
      // Priced on what was ASKED for, which is what the picker priced its
      // presets on. The generator is allowed to return fewer questions than
      // requested, and using the delivered count would quietly move the line
      // under a student who took an honest preset.
      const bonusCap = speedBonusMaxSeconds(session.requested_count || questions.length || 1);
      if (elapsed != null && elapsed <= challenge.seconds && challenge.seconds <= bonusCap) {
        recordGamificationEvent(user.id, "coach_beat_timer");
      }
    }
    // Friday / Saturday / Sunday bonus, paid for studying rather than for
    // opening the app. No-ops on a weekday and at most once a day.
    recordWeekendMissionIfDue(user.id);
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
      recordWeekendMissionIfDue(user.id);
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
  const answeredCount = questions.filter((question) => (answers[question.id] ?? "").trim()).length;
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
            eyebrow="PQ"
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
              {secondsLeft != null && (
                <span
                  role="timer"
                  aria-live="off"
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold tabular-nums ${
                    secondsLeft === 0
                      ? "border-border text-muted-foreground"
                      : secondsLeft <= 60
                        ? "border-destructive/40 bg-destructive/10 text-destructive"
                        : "border-pop/40 bg-pop/10 text-pop"
                  }`}
                >
                  <Timer className="h-3.5 w-3.5" />
                  {secondsLeft === 0 ? "Time up" : formatClock(secondsLeft)}
                </span>
              )}
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

                    {/* Above the coach notes on purpose: on a challenge, "who
                        won" is the first thing the student is looking for. */}
                    {challengeResult && <ChallengeResultCard summary={challengeResult} />}

                    {review?.coaching ? (
                      <div className="rounded-2xl border border-pop/20 bg-pop/5 p-4">
                        <div className="mb-1 text-sm font-semibold">Coach notes</div>
                        <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                          {review.coaching}
                        </p>
                      </div>
                    ) : null}

                    {incorrectQuestions.length === 0 && (
                      <div className="rounded-2xl border border-leaf/30 bg-leaf/10 p-4 text-center text-sm font-medium text-leaf">
                        Perfect score - every question correct. 🎉
                      </div>
                    )}
                    <div>
                      <h3 className="mb-2 text-sm font-semibold">Answers &amp; explanations</h3>
                      <div className="space-y-3">
                        {questions.map((question, index) => {
                          const correct = isGradeCorrect(grades[question.id]);
                          return (
                            <div
                              key={question.id}
                              className={`rounded-2xl border p-3 sm:p-4 ${
                                correct
                                  ? "border-leaf/30 bg-leaf/5"
                                  : "border-destructive/30 bg-destructive/5"
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                  {question.question_type} · {index + 1}
                                </span>
                                <span
                                  className={`inline-flex items-center gap-1 text-xs font-semibold ${
                                    correct ? "text-leaf" : "text-destructive"
                                  }`}
                                >
                                  {correct ? (
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                  ) : (
                                    <XCircle className="h-3.5 w-3.5" />
                                  )}
                                  {correct ? "Correct" : "Incorrect"}
                                </span>
                              </div>
                              <p className="text-sm font-medium break-words">{question.prompt}</p>
                              <p className="mt-2 flex items-start gap-1.5 text-sm break-words">
                                <span className="min-w-0">
                                  <span className="font-semibold">Your answer: </span>
                                  {question.question_type === "mcq"
                                    ? optionLabel(question, answers[question.id])
                                    : answers[question.id] || "-"}
                                </span>
                              </p>
                              <AnswerFeedback
                                question={question}
                                grade={grades[question.id]}
                                sourcesStripped={!!challengeId}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

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
                      const locked =
                        mode === "learning" && isMcq && (!!grade || !!gradingIds[question.id]);
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
                          <SourceOrWarn question={question} sourcesStripped={!!challengeId} />
                          {isMcq ? (
                            <div className="mt-3 space-y-2">
                              {(question.options ?? []).map((option) => {
                                const selected = answers[question.id] === option.id;
                                const isCorrectOption = option.id === question.correct_answer;
                                let cls =
                                  "border-border hover:border-pop/30 hover:bg-foreground/[0.02]";
                                if (showFeedback) {
                                  if (isCorrectOption) cls = "border-leaf/50 bg-leaf/10 text-leaf";
                                  else if (selected)
                                    cls =
                                      "border-destructive/60 bg-destructive/10 text-destructive";
                                  else cls = "border-border opacity-60";
                                } else if (selected) {
                                  cls = "border-pop/50 bg-pop/10";
                                }
                                return (
                                  <button
                                    key={option.id}
                                    disabled={completed || locked}
                                    onClick={() => {
                                      if (mode === "learning") {
                                        void answerLearningMcq(question, option.id);
                                      } else {
                                        setAnswers((current) => ({
                                          ...current,
                                          [question.id]: option.id,
                                        }));
                                      }
                                    }}
                                    className={`flex w-full items-start gap-2 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-default ${cls}`}
                                  >
                                    <span className="shrink-0 font-semibold">{option.id}</span>
                                    <span className="min-w-0 flex-1 break-words">
                                      {option.text}
                                    </span>
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
                            <AnswerFeedback
                              question={question}
                              grade={grade}
                              sourcesStripped={!!challengeId}
                            />
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
                        {reviewLoading ? <LoadingDots /> : <GraduationCap className="h-4 w-4" />}
                        Submit quiz
                      </button>
                    ) : !completed ? (
                      <button
                        onClick={finishLearning}
                        disabled={!learningReady || reviewLoading}
                        className="btn-pop inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold"
                      >
                        {reviewLoading ? <LoadingDots /> : <CheckCircle2 className="h-4 w-4" />}
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
                    {/* Same line as every other question list, rather than a
                        second copy of it that could drift. */}
                    <SourceOrWarn question={question} sourcesStripped={!!challengeId} />
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
                    {completed && (
                      <AnswerFeedback
                        question={question}
                        grade={grades[question.id]}
                        sourcesStripped={!!challengeId}
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
                    {reviewLoading ? <LoadingDots /> : <CheckCircle2 className="h-4 w-4" />}
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
