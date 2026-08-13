// G&D — My Coach (StudyBody) for the native app.
//
// Full-parity port of the web "My Coach": build a grounded roadmap from uploaded
// docs, track per-topic mastery, then practice (MCQ / Essay / Mixed / Flashcards)
// at Easy/Medium/Hard in Learning (instant feedback) or Exam (timed) mode. Every
// question cites a [Page X] source; sets autosave so a half-finished one resumes.
//
// All AI runs server-side in the studybody edge function; retrieval is grounded
// via studybody-data (hybrid embedding + keyword search over document_chunks).

import { Link } from "expo-router";
import {
  AlertTriangle,
  Brain,
  Check,
  CheckCircle2,
  ChevronLeft,
  FileText,
  Map as MapIcon,
  Play,
  RotateCcw,
  Sparkles,
  Target,
  Trophy,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, EmptyState, Field, PresetOrCustom, ProgressBar, Tag } from "@/components/ui";
import { toast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import {
  type DifficultyLevel,
  type DocRow,
  db,
  difficultyFromScore,
  finalizeTopicMastery,
  folderName,
  formatClock,
  loadStudyDocuments,
  loadStudyDocumentsSpanning,
  MAX_TIMER_MINUTES,
  MIN_TIMER_MINUTES,
  parseQuestionCount,
  parseTimerMinutes,
  type PlanRow,
  type PracticeMode,
  QUESTION_COUNT_MAX,
  QUESTION_COUNT_MIN,
  QUESTION_COUNTS,
  type QuestionRow,
  type SessionRow,
  sourceText,
  timerPresetMinutes,
  type TopicRow,
} from "@/lib/studybody-data";
import {
  type GeneratedFlashcard,
  type GeneratedQuestion,
  generateFlashcards,
  generateStudyPlan,
  generateStudyQuestions,
  reviewStudyAnswers,
  type StudyQuestionType,
  type StudyRoadmapTopic,
  type StudyReview,
} from "@/lib/studybody-client";
import { submitChallengeForSession } from "@/lib/social";
import { colors, fonts, radius } from "@/lib/theme";
import { BOTTOM_NAV_HEIGHT, MainTabContainer, ScreenContainer, TopBar, useDrawer, useHaptics } from "@/platform";

const QUESTION_TYPES: { value: StudyQuestionType; label: string }[] = [
  { value: "mcq", label: "MCQ" },
  { value: "essay", label: "Essay" },
  { value: "mixed", label: "Mixed" },
  { value: "flashcard", label: "Cards" },
];
const DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard"];
const STATUS_LABEL: Record<TopicRow["status"], string> = {
  not_started: "Not started",
  learning: "Learning",
  practicing: "Practicing",
  mastered: "Mastered",
};

type ViewMode = "config" | "session";

function correctionMode(preferred: string | null | undefined): "Simplified" | "Detailed" | "Storytelling" {
  return preferred === "Detailed" ? "Detailed" : preferred === "Storytelling" ? "Storytelling" : "Simplified";
}

export default function CoachScreen() {
  const { open } = useDrawer();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();

  // Roadmap / topic data
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [topics, setTopics] = useState<TopicRow[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [planTitle, setPlanTitle] = useState("");
  const [courseOutline, setCourseOutline] = useState("");
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [building, setBuilding] = useState(false);

  // Practice config
  const [view, setView] = useState<ViewMode>("config");
  const [questionType, setQuestionType] = useState<StudyQuestionType>("mcq");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");
  const [mode, setMode] = useState<PracticeMode>("learning");
  // 10 replaces the old default of 5 now that 3 and 5 are gone from the
  // presets — it's the new floor, so "just start" lands on the smallest set
  // rather than defaulting into the middle of the new, bigger range.
  const [questionCount, setQuestionCount] = useState<number>(QUESTION_COUNTS[0]);
  const [isCustomCount, setIsCustomCount] = useState(false);
  const [customCountText, setCustomCountText] = useState("");
  const [resumable, setResumable] = useState<SessionRow | null>(null);

  // Exam-mode duration. examMinutes holds the active preset while not on
  // Custom (kept re-priced to the set size, same as the web picker); the
  // duration actually running a session is snapshotted into
  // activeDurationSeconds at start/resume time so editing the config screen
  // never reaches into a session that's already underway.
  const [examMinutes, setExamMinutes] = useState(0);
  const [isCustomTimer, setIsCustomTimer] = useState(false);
  const [customTimerText, setCustomTimerText] = useState("");
  const [activeDurationSeconds, setActiveDurationSeconds] = useState(0);

  // Session state
  const [starting, setStarting] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [activeSession, setActiveSession] = useState<SessionRow | null>(null);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [revealed, setRevealed] = useState<string[]>([]);
  const [review, setReview] = useState<StudyReview | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Flashcards (ephemeral — a study aid, not graded)
  const [flashcards, setFlashcards] = useState<GeneratedFlashcard[]>([]);
  const [flashIndex, setFlashIndex] = useState(0);
  const [flashFlipped, setFlashFlipped] = useState(false);

  const askedByTopicRef = useRef<Record<string, string[]>>({});
  const sessionStartRef = useRef<number>(0);
  const feedbackBaseRef = useRef<Record<string, unknown>>({});

  const activePlan = useMemo(
    () => plans.find((p) => p.id === selectedPlanId) ?? null,
    [plans, selectedPlanId],
  );
  const activeTopic = useMemo(
    () => topics.find((t) => t.id === selectedTopicId) ?? null,
    [topics, selectedTopicId],
  );
  const averageMastery = useMemo(() => {
    if (!topics.length) return 0;
    return Math.round(
      topics.reduce((sum, t) => sum + Number(t.mastery_score || 0), 0) / topics.length,
    );
  }, [topics]);
  const masteredCount = useMemo(
    () => topics.filter((t) => t.status === "mastered").length,
    [topics],
  );

  // The count actually in effect: the picked preset, or the typed Custom
  // value once it parses. Never silently clamped — an invalid Custom value
  // resolves to null + an error string so the start buttons can block instead
  // of quietly sending a different number than what's on screen.
  const countResult = isCustomCount ? parseQuestionCount(customCountText) : { ok: true as const, count: questionCount };
  const resolvedCount = countResult.ok ? countResult.count : null;
  const countError = countResult.ok ? null : countResult.error;

  // Timer presets re-price off the count in effect (falling back to the last
  // preset while Custom count is mid-edit/invalid) so "suggested pace" always
  // reflects the set actually being built.
  const timerPresets = useMemo(
    () => timerPresetMinutes(resolvedCount ?? questionCount),
    [resolvedCount, questionCount],
  );
  useEffect(() => {
    setExamMinutes((current) => (timerPresets.includes(current) ? current : timerPresets[1] ?? timerPresets[0] ?? 0));
  }, [timerPresets]);

  const timerResult = isCustomTimer ? parseTimerMinutes(customTimerText) : { ok: true as const, seconds: examMinutes * 60 };
  const resolvedTimerSeconds = timerResult.ok ? timerResult.seconds : null;
  const timerError = timerResult.ok ? null : timerResult.error;

  // ─── Data loading ──────────────────────────────────────────────────────────

  const refreshDocsAndPlans = useCallback(async () => {
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
  }, [user]);

  const refreshTopics = useCallback(
    async (planId: string) => {
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
      const next = (data as TopicRow[]) ?? [];
      setTopics(next);
      setSelectedTopicId((current) =>
        current && next.some((t) => t.id === current) ? current : next[0]?.id || "",
      );
    },
    [user],
  );

  useEffect(() => {
    void refreshDocsAndPlans();
  }, [refreshDocsAndPlans]);

  useEffect(() => {
    void refreshTopics(selectedPlanId);
    resetSession();
    askedByTopicRef.current = {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId, refreshTopics]);

  // Look for a half-finished set whenever the selected topic / type changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user || !activeTopic) {
        setResumable(null);
        return;
      }
      const { data } = await db
        .from("study_sessions")
        .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
        .eq("user_id", user.id)
        .eq("topic_id", activeTopic.id)
        .eq("status", "in_progress")
        .order("created_at", { ascending: false });
      const rows = (data as SessionRow[]) ?? [];
      if (!cancelled) setResumable(rows[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, activeTopic]);

  // Exam-mode timer.
  useEffect(() => {
    if (view !== "session" || mode !== "exam" || review) return;
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - sessionStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [view, mode, review]);

  // Debounced autosave of in-progress answers so a set resumes in place.
  useEffect(() => {
    if (!activeSession || review || flashcards.length > 0) return;
    const id = setTimeout(() => {
      void db
        .from("study_sessions")
        .update({
          feedback: { ...feedbackBaseRef.current, draftAnswers: answers, revealed },
        })
        .eq("id", activeSession.id);
    }, 800);
    return () => clearTimeout(id);
  }, [answers, revealed, activeSession, review, flashcards.length]);

  // ─── Helpers ─────────────────────────────────────────────────────────────

  function resetSession() {
    setView("config");
    setActiveSession(null);
    setQuestions([]);
    setAnswers({});
    setRevealed([]);
    setReview(null);
    setElapsed(0);
    setActiveDurationSeconds(0);
    setFlashcards([]);
    setFlashIndex(0);
    setFlashFlipped(false);
  }

  const toggleDoc = (id: string) => {
    setSelectedDocIds((cur) =>
      cur.includes(id) ? cur.filter((d) => d !== id) : [...cur, id],
    );
  };

  const selectTopic = (topic: TopicRow) => {
    setSelectedTopicId(topic.id);
    resetSession();
  };

  // ─── Roadmap building ────────────────────────────────────────────────────

  const createPlan = async () => {
    if (!user || !profile) return;
    if (schemaMissing) {
      toast.error("My Coach tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    if (!selectedDocIds.length && !courseOutline.trim()) {
      toast.error("Pick files or paste a course outline first.");
      return;
    }
    setBuilding(true);
    try {
      const studyDocs = await loadStudyDocumentsSpanning(selectedDocIds, docs);
      const generated = await generateStudyPlan({
        profile,
        planTitle: planTitle.trim() || "My Coach roadmap",
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

      setPlans((cur) => [plan, ...cur]);
      setSelectedPlanId(plan.id);
      setPlanTitle("");
      setCourseOutline("");
      haptics.success();
      toast.success("Roadmap created");
      await refreshTopics(plan.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create roadmap");
    } finally {
      setBuilding(false);
    }
  };

  // ─── Practice: start / resume ───────────────────────────────────────────

  const sourceDocIds = () =>
    activePlan?.source_document_ids?.length ? activePlan.source_document_ids : selectedDocIds;

  const startPractice = async (topic: TopicRow | null) => {
    if (!user || !profile || !activePlan || !topic) return;
    if (schemaMissing) {
      toast.error("My Coach tables are missing in Supabase. Apply the StudyBody migration first.");
      return;
    }
    const ids = sourceDocIds();
    if (!ids.length) {
      toast.error("This roadmap needs at least one source file for practice.");
      return;
    }

    // Validate BEFORE calling the generation edge function — a bad count or
    // timer must never reach it, both because a huge count is slow and costs
    // real money per set, and because a rejected number should say why
    // instead of silently starting with something else.
    if (resolvedCount == null) {
      toast.error(countError ?? "Fix the question count first.");
      return;
    }
    if (mode === "exam" && questionType !== "flashcard" && resolvedTimerSeconds == null) {
      toast.error(timerError ?? "Fix the timer first.");
      return;
    }

    if (questionType === "flashcard") {
      return startFlashcards(topic, ids, resolvedCount);
    }

    setStarting(true);
    setReview(null);
    setAnswers({});
    setRevealed([]);
    try {
      const studyDocs = await loadStudyDocuments(ids, topic.title);
      const exclude = askedByTopicRef.current[topic.id] ?? [];
      const mixedSplit =
        questionType === "mixed"
          ? { mcqCount: Math.ceil(resolvedCount / 2), essayCount: Math.floor(resolvedCount / 2) }
          : {};
      const generated = await generateStudyQuestions({
        profile,
        topic,
        questionType,
        count: resolvedCount,
        ...mixedSplit,
        documents: studyDocs,
        excludePrompts: exclude,
        difficultyHint: difficultyFromScore(Number(topic.mastery_score || 0)),
        difficulty,
      });
      if (!generated.questions.length) {
        toast.message("No fresh questions left from this material. Try another topic or add files.");
        return;
      }

      const timerSeconds = mode === "exam" ? (resolvedTimerSeconds ?? 0) : 0;
      feedbackBaseRef.current = { mode, questionType, difficulty, timerSeconds };
      const { data: sessionData, error: sessionErr } = await db
        .from("study_sessions")
        .insert({
          user_id: user.id,
          plan_id: activePlan.id,
          topic_id: topic.id,
          question_type: questionType,
          requested_count: resolvedCount,
          total_questions: generated.questions.length,
          feedback: feedbackBaseRef.current,
        })
        .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
        .single();
      if (sessionErr) throw sessionErr;
      const session = sessionData as SessionRow;

      const questionRows = generated.questions.map((q: GeneratedQuestion, index: number) => {
        const normalizedType: "mcq" | "essay" =
          q.type === "essay" || questionType === "essay" ? "essay" : "mcq";
        return {
          user_id: user.id,
          session_id: session.id,
          plan_id: activePlan.id,
          topic_id: topic.id,
          question_type: normalizedType,
          prompt: q.prompt,
          options: normalizedType === "mcq" ? (q.options ?? []) : [],
          correct_answer: q.correct_answer,
          explanation: q.explanation ?? "",
          rubric: q.rubric ?? [],
          difficulty: q.difficulty ?? difficulty,
          source_refs: q.source_refs ?? [],
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
        ...generated.questions.map((q) => q.prompt),
      ];

      await db
        .from("study_topics")
        .update({ status: "practicing", last_practiced_at: new Date().toISOString() })
        .eq("id", topic.id);
      await refreshTopics(activePlan.id);

      setActiveSession(session);
      setQuestions((savedQuestions as QuestionRow[]) ?? []);
      sessionStartRef.current = Date.now();
      setElapsed(0);
      setActiveDurationSeconds(timerSeconds);
      setResumable(null);
      setView("session");
      haptics.success();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start practice");
    } finally {
      setStarting(false);
    }
  };

  const startFlashcards = async (topic: TopicRow, ids: string[], count: number) => {
    if (!profile) return;
    setStarting(true);
    try {
      const studyDocs = await loadStudyDocuments(ids, topic.title);
      const generated = await generateFlashcards({
        profile,
        topic,
        count,
        documents: studyDocs,
      });
      if (!generated.flashcards.length) {
        toast.message("No flashcards could be made from this material yet.");
        return;
      }
      setFlashcards(generated.flashcards);
      setFlashIndex(0);
      setFlashFlipped(false);
      setView("session");
      haptics.success();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not build flashcards");
    } finally {
      setStarting(false);
    }
  };

  const resumeSession = async (session: SessionRow) => {
    if (!user) return;
    setStarting(true);
    try {
      const { data, error } = await db
        .from("study_questions")
        .select(
          "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
        )
        .eq("session_id", session.id)
        .order("position", { ascending: true });
      if (error) throw error;
      const fb = (session.feedback ?? {}) as SessionRow["feedback"] & { timerSeconds?: number };
      const timerSeconds = typeof fb?.timerSeconds === "number" ? fb.timerSeconds : 0;
      feedbackBaseRef.current = {
        mode: fb?.mode ?? "learning",
        questionType: fb?.questionType ?? session.question_type,
        difficulty: fb?.difficulty ?? "medium",
        timerSeconds,
      };
      setMode((fb?.mode as PracticeMode) ?? "learning");
      setQuestionType(session.question_type);
      if (fb?.difficulty) setDifficulty(fb.difficulty);
      setActiveSession(session);
      setQuestions((data as QuestionRow[]) ?? []);
      setAnswers(fb?.draftAnswers ?? {});
      setRevealed(fb?.revealed ?? []);
      setReview(null);
      sessionStartRef.current = Date.now();
      setElapsed(0);
      // A session saved before this feature shipped has no timerSeconds in its
      // feedback JSONB — 0 falls back to the old plain elapsed stopwatch below,
      // which is exactly what that session was already showing.
      setActiveDurationSeconds(timerSeconds);
      setView("session");
      haptics.medium();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not resume");
    } finally {
      setStarting(false);
    }
  };

  // Instant on-device feedback for MCQ in Learning mode (the authoritative grade
  // still comes from the AI review at submit).
  const pickOption = (q: QuestionRow, optionId: string) => {
    setAnswers((cur) => ({ ...cur, [q.id]: optionId }));
    if (mode === "learning" && q.question_type === "mcq") {
      setRevealed((cur) => (cur.includes(q.id) ? cur : [...cur, q.id]));
      haptics.light();
    }
  };

  const isCorrect = (q: QuestionRow) =>
    (answers[q.id] ?? "").toLowerCase() === (q.correct_answer ?? "").toLowerCase();

  // ─── Submit + review ────────────────────────────────────────────────────

  const submitPractice = async () => {
    if (!user || !profile || !activeSession || !activeTopic) return;
    const missing = questions.filter((q) => !answers[q.id]?.trim());
    if (missing.length) {
      toast.error("Answer every question before submitting.");
      return;
    }
    setReviewing(true);
    try {
      const result = await reviewStudyAnswers({
        profile,
        mode: correctionMode(profile.preferred_mode),
        questions: questions.map((q) => ({
          id: q.id,
          type: q.question_type,
          prompt: q.prompt,
          options: q.options ?? [],
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          rubric: q.rubric ?? [],
          source_refs: q.source_refs ?? [],
        })),
        answers,
      });

      const gradingAnswers = result.grading.answers ?? [];
      const answerRows = questions.map((q, index) => {
        const grade =
          gradingAnswers.find((it) => it.question_id === q.id) ?? gradingAnswers[index] ?? {};
        return {
          user_id: user.id,
          question_id: q.id,
          session_id: activeSession.id,
          answer: answers[q.id],
          is_correct: grade.is_correct ?? null,
          score: grade.score ?? null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });

      const percentage = Math.round(Number(result.grading.percentage ?? 0));
      const score = Number(result.grading.score ?? 0);
      const timeTaken = Math.floor((Date.now() - sessionStartRef.current) / 1000);

      await db.from("study_answers").insert(answerRows);
      await db
        .from("study_sessions")
        .update({
          status: "completed",
          score: percentage,
          feedback: { ...feedbackBaseRef.current, ...result, time_taken_seconds: timeTaken },
          completed_at: new Date().toISOString(),
        })
        .eq("id", activeSession.id);

      // If this set is half of a friend challenge, tell the server it is
      // finished now. Immediately after the status update, never before it: the
      // RPC reads the completed session back. Without this call a student could
      // accept a challenge, play it through, and have their score never register
      // — the contest would sit open forever and the friend on the other side
      // would wait on a result that was never coming.
      await submitChallengeForSession(activeSession.id);

      const mastered = await finalizeTopicMastery(activeTopic.id, percentage);
      await db.from("study_preferences").upsert({
        user_id: user.id,
        preferred_question_type: questionType,
        correction_style: correctionMode(profile.preferred_mode),
        adaptive_notes: {
          weak_areas: result.grading.weak_areas ?? [],
          next_steps: result.grading.next_steps ?? [],
          last_score: percentage,
          raw_score: score,
        },
        updated_at: new Date().toISOString(),
      });

      setReview(result);
      setActiveSession({ ...activeSession, status: "completed", score: percentage });
      await refreshTopics(activeSession.plan_id);
      haptics.success();

      if (mastered) {
        toast.success(`${activeTopic.title} mastered.`);
      } else {
        toast.success("Reviewed — keep going to master this topic.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not review answers");
    } finally {
      setReviewing(false);
    }
  };

  const continueWithNew = () => {
    resetSession();
    void startPractice(activeTopic);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const scrollPad = { paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 32 };

  if (view === "session" && flashcards.length > 0) {
    return (
      <FlashcardRunner
        topicTitle={activeTopic?.title ?? "Flashcards"}
        cards={flashcards}
        index={flashIndex}
        flipped={flashFlipped}
        onFlip={() => {
          setFlashFlipped((f) => !f);
          haptics.light();
        }}
        onNext={() => {
          setFlashFlipped(false);
          setFlashIndex((i) => Math.min(flashcards.length - 1, i + 1));
          haptics.light();
        }}
        onPrev={() => {
          setFlashFlipped(false);
          setFlashIndex((i) => Math.max(0, i - 1));
        }}
        onExit={resetSession}
        scrollPad={scrollPad}
        cardsLength={flashcards.length}
      />
    );
  }

  return (
    <MainTabContainer>
      <TopBar
        title="My Coach"
        onMenu={view === "config" ? open : undefined}
        onBack={view === "session" ? resetSession : undefined}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, scrollPad]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {view === "config" ? (
          <>
            <View style={styles.kicker}>
              <MapIcon size={15} color={colors.accent} />
              <Text style={styles.kickerText}>LEARNING PATH</Text>
            </View>
            <Text style={styles.h1}>Build a roadmap, practice, master it.</Text>

            <View style={styles.metricsRow}>
              <Metric label="Roadmaps" value={plans.length.toString()} />
              <Metric label="Topics" value={topics.length.toString()} />
              <Metric label="Mastery" value={`${averageMastery}%`} />
            </View>

            {schemaMissing ? (
              <View style={styles.schemaCard}>
                <Text style={styles.schemaTitle}>My Coach database tables are missing</Text>
                <Text style={styles.schemaBody}>
                  Apply the StudyBody migration in Supabase, then reopen this screen. Generation is
                  paused so AI credits aren't wasted.
                </Text>
              </View>
            ) : null}

            {/* New roadmap */}
            <View style={styles.card}>
              <SectionHead icon={<Sparkles size={15} color={colors.accent} />} title="New roadmap" />
              <Field value={planTitle} onChangeText={setPlanTitle} placeholder="Course or topic name" />
              <Field
                value={courseOutline}
                onChangeText={setCourseOutline}
                placeholder="Paste a course outline, or leave blank to build from the selected files"
                multiline
                style={{ marginTop: 10 }}
              />
              <View style={styles.sourcesHeader}>
                <Text style={styles.sourcesLabel}>SOURCES</Text>
                <Text style={styles.sourcesCount}>{selectedDocIds.length} selected</Text>
              </View>
              <View style={{ gap: 8 }}>
                {docs.length === 0 ? (
                  <Link href="/library" asChild>
                    <Pressable style={styles.uploadLink}>
                      <Text style={styles.uploadLinkText}>Upload files in Library →</Text>
                    </Pressable>
                  </Link>
                ) : (
                  docs.map((doc) => {
                    const selected = selectedDocIds.includes(doc.id);
                    return (
                      <Pressable
                        key={doc.id}
                        onPress={() => toggleDoc(doc.id)}
                        style={[styles.docRow, selected ? styles.rowActive : styles.rowIdle]}
                      >
                        <FileText size={16} color={colors.accent} style={{ marginTop: 2 }} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.docName} numberOfLines={1}>
                            {doc.file_name}
                          </Text>
                          <Text style={styles.docFolder}>{folderName(doc) || "Uncategorised"}</Text>
                        </View>
                        {selected ? <Check size={16} color={colors.accent} /> : null}
                      </Pressable>
                    );
                  })
                )}
              </View>
              <Button
                label="Build roadmap"
                onPress={createPlan}
                loading={building}
                icon={<Sparkles size={16} color={colors.primaryFg} />}
                style={{ marginTop: 14 }}
              />
            </View>

            {/* Roadmaps switcher */}
            {plans.length > 0 ? (
              <View style={styles.card}>
                <SectionHead icon={<Target size={15} color={colors.accent} />} title="Roadmaps" />
                <View style={{ gap: 8 }}>
                  {plans.map((plan) => {
                    const selected = selectedPlanId === plan.id;
                    return (
                      <Pressable
                        key={plan.id}
                        onPress={() => setSelectedPlanId(plan.id)}
                        style={[styles.planRow, selected ? styles.rowActive : styles.rowIdle]}
                      >
                        <Text style={styles.planTitle} numberOfLines={1}>
                          {plan.title}
                        </Text>
                        <Text style={styles.planType}>{plan.source_type}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {/* Topics timeline */}
            {activePlan ? (
              <View style={styles.card}>
                <View style={styles.roadmapHeader}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.roadmapTitle} numberOfLines={1}>
                      {activePlan.title}
                    </Text>
                    <Text style={styles.roadmapMeta}>
                      {topics.length} topics · {activePlan.source_type}
                    </Text>
                  </View>
                  <View style={styles.masteredPill}>
                    <Trophy size={13} color={colors.accent} />
                    <Text style={styles.masteredText}>
                      {masteredCount}/{topics.length}
                    </Text>
                  </View>
                </View>

                {topics.length > 0 ? (
                  <View style={{ marginTop: 12 }}>
                    <View style={styles.progressLabelRow}>
                      <Text style={styles.progressLabel}>Roadmap progress</Text>
                      <Text style={styles.progressValue}>{averageMastery}%</Text>
                    </View>
                    <ProgressBar value={averageMastery} />
                  </View>
                ) : null}

                <View style={styles.timeline}>
                  {topics.length === 0 ? (
                    <EmptyState text="Your roadmap topics will appear here." />
                  ) : (
                    topics.map((topic, index) => (
                      <TopicPhase
                        key={topic.id}
                        topic={topic}
                        index={index}
                        last={index === topics.length - 1}
                        selected={selectedTopicId === topic.id}
                        onPress={() => selectTopic(topic)}
                      />
                    ))
                  )}
                </View>
              </View>
            ) : null}

            {/* Practice config for the selected topic */}
            {activeTopic ? (
              <View style={styles.card}>
                <SectionHead icon={<Brain size={15} color={colors.accent} />} title="Practice" />
                <View style={styles.topicBrief}>
                  <Text style={styles.topicBriefTitle}>{activeTopic.title}</Text>
                  {activeTopic.summary ? (
                    <Text style={styles.topicBriefBody}>{activeTopic.summary}</Text>
                  ) : null}
                </View>

                <Text style={styles.configLabel}>TYPE</Text>
                <View style={styles.pillRow}>
                  {QUESTION_TYPES.map((t) => (
                    <Pill
                      key={t.value}
                      label={t.label}
                      active={questionType === t.value}
                      onPress={() => setQuestionType(t.value)}
                    />
                  ))}
                </View>

                {questionType !== "flashcard" ? (
                  <>
                    <Text style={styles.configLabel}>DIFFICULTY</Text>
                    <View style={styles.pillRow}>
                      {DIFFICULTIES.map((d) => (
                        <Pill
                          key={d}
                          label={d}
                          active={difficulty === d}
                          onPress={() => setDifficulty(d)}
                        />
                      ))}
                    </View>

                    <Text style={styles.configLabel}>MODE</Text>
                    <View style={styles.pillRow}>
                      <Pill label="Learning" active={mode === "learning"} onPress={() => setMode("learning")} />
                      <Pill label="Exam" active={mode === "exam"} onPress={() => setMode("exam")} />
                    </View>
                    <Text style={styles.modeHint}>
                      {mode === "learning"
                        ? "Instant feedback after each question."
                        : "Timed — graded when you submit."}
                    </Text>

                    {mode === "exam" ? (
                      <>
                        <Text style={styles.configLabel}>TIME LIMIT</Text>
                        <PresetOrCustom
                          options={timerPresets}
                          isCustom={isCustomTimer}
                          activeValue={examMinutes}
                          customText={customTimerText}
                          onPreset={(value) => {
                            setIsCustomTimer(false);
                            setExamMinutes(value);
                          }}
                          onCustom={() => setIsCustomTimer(true)}
                          onCustomText={setCustomTimerText}
                          suffix=" min"
                          placeholder={`Minutes (${MIN_TIMER_MINUTES}-${MAX_TIMER_MINUTES})`}
                          error={timerError}
                          hint={`Up to ${MAX_TIMER_MINUTES} minutes. Running out doesn't submit for you — the set stays open.`}
                        />
                      </>
                    ) : null}
                  </>
                ) : null}

                <Text style={styles.configLabel}>
                  {questionType === "flashcard" ? "CARDS" : "QUESTIONS"}
                </Text>
                <PresetOrCustom
                  options={QUESTION_COUNTS}
                  isCustom={isCustomCount}
                  activeValue={questionCount}
                  customText={customCountText}
                  onPreset={(value) => {
                    setIsCustomCount(false);
                    setQuestionCount(value);
                  }}
                  onCustom={() => setIsCustomCount(true)}
                  onCustomText={setCustomCountText}
                  placeholder={`Count (${QUESTION_COUNT_MIN}-${QUESTION_COUNT_MAX})`}
                  error={countError}
                  hint={`Pick ${QUESTION_COUNT_MIN}-${QUESTION_COUNT_MAX}.`}
                />

                {resumable && questionType !== "flashcard" ? (
                  <Button
                    label="Continue where you left off"
                    variant="secondary"
                    onPress={() => resumeSession(resumable)}
                    loading={starting}
                    icon={<RotateCcw size={16} color={colors.text} />}
                    style={{ marginTop: 16 }}
                  />
                ) : null}

                <Button
                  label={resumable && questionType !== "flashcard" ? "Start a new set" : "Start practice"}
                  onPress={() => startPractice(activeTopic)}
                  loading={starting}
                  disabled={
                    resolvedCount == null ||
                    (mode === "exam" && questionType !== "flashcard" && resolvedTimerSeconds == null)
                  }
                  icon={<Play size={16} color={colors.primaryFg} />}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : (
              <View style={styles.card}>
                <EmptyState text="Pick a topic above to practice." />
              </View>
            )}
          </>
        ) : (
          /* ─── Session runner (MCQ / Essay / Mixed) ─── */
          <>
            <View style={styles.sessionHead}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.kickerText}>{questionType.toUpperCase()} · {difficulty.toUpperCase()}</Text>
                <Text style={styles.sessionTitle} numberOfLines={1}>
                  {activeTopic?.title ?? "Practice"}
                </Text>
              </View>
              {mode === "exam" && !review ? (
                <View style={styles.timerPill}>
                  <Text style={styles.timerText}>
                    {activeDurationSeconds > 0
                      ? // Counts DOWN from the chosen duration. Hitting zero costs
                        // nothing but the "on the clock" feel — it does not submit
                        // for the student, the set just keeps running untimed from
                        // here (same rule the web's "Race the clock" uses).
                        elapsed >= activeDurationSeconds
                        ? "Time up"
                        : formatClock(activeDurationSeconds - elapsed)
                      : // Legacy sessions saved before custom timers existed have no
                        // stored duration — fall back to the plain stopwatch they
                        // were already showing.
                        formatClock(elapsed)}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={{ gap: 14 }}>
              {questions.map((q, index) => {
                const showFeedback = mode === "learning" && revealed.includes(q.id) && !review;
                const grounded = Array.isArray(q.source_refs) && q.source_refs.length > 0;
                return (
                  <View key={q.id} style={styles.qCard}>
                    <Text style={styles.qMeta}>
                      {q.question_type} · {q.difficulty} · {index + 1}/{questions.length}
                    </Text>
                    <Text style={styles.qPrompt}>{q.prompt}</Text>

                    {grounded ? (
                      <View style={styles.sourceTag}>
                        <FileText size={12} color={colors.accent} style={{ marginTop: 1 }} />
                        <Text style={styles.sourceTagText}>Source: {sourceText(q.source_refs)}</Text>
                      </View>
                    ) : (
                      <View style={styles.warnTag}>
                        <AlertTriangle size={12} color={colors.warning} style={{ marginTop: 1 }} />
                        <Text style={styles.warnTagText}>
                          Not found in your material — answer with caution.
                        </Text>
                      </View>
                    )}

                    {q.question_type === "mcq" ? (
                      <View style={{ gap: 8, marginTop: 12 }}>
                        {(q.options ?? []).map((opt) => {
                          const picked = answers[q.id] === opt.id;
                          const correct =
                            opt.id.toLowerCase() === (q.correct_answer ?? "").toLowerCase();
                          let rowStyle: ViewStyle = styles.rowIdle;
                          if (showFeedback && correct) rowStyle = styles.optionCorrect;
                          else if (showFeedback && picked && !correct) rowStyle = styles.optionWrong;
                          else if (picked) rowStyle = styles.rowActive;
                          return (
                            <Pressable
                              key={opt.id}
                              disabled={showFeedback}
                              onPress={() => pickOption(q, opt.id)}
                              style={[styles.optionRow, rowStyle]}
                            >
                              <Text style={styles.optionId}>{opt.id}</Text>
                              <Text style={styles.optionText}>{opt.text}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <Field
                        value={answers[q.id] ?? ""}
                        onChangeText={(text) => setAnswers((cur) => ({ ...cur, [q.id]: text }))}
                        placeholder="Write your answer"
                        multiline
                        style={{ marginTop: 12 }}
                      />
                    )}

                    {showFeedback ? (
                      <View style={styles.qFeedback}>
                        <Text style={[styles.qFeedbackTag, { color: isCorrect(q) ? colors.success : colors.danger }]}>
                          {isCorrect(q) ? "CORRECT" : "NOT QUITE"}
                        </Text>
                        {q.explanation ? <Text style={styles.qFeedbackText}>{q.explanation}</Text> : null}
                      </View>
                    ) : null}
                  </View>
                );
              })}

              {!review ? (
                <Button
                  label="Submit & review"
                  onPress={submitPractice}
                  loading={reviewing}
                  icon={<CheckCircle2 size={16} color={colors.primaryFg} />}
                />
              ) : null}

              {review ? (
                <View style={styles.reviewCard}>
                  <View style={styles.reviewHeader}>
                    <Text style={styles.reviewLabel}>Review</Text>
                    <Text style={styles.reviewScore}>
                      {Math.round(Number(review.grading.percentage ?? 0))}%
                    </Text>
                  </View>
                  <Text style={styles.reviewCoaching}>{review.coaching}</Text>
                  <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                    <Button
                      label="Back to roadmap"
                      variant="secondary"
                      onPress={resetSession}
                      icon={<ChevronLeft size={16} color={colors.text} />}
                      style={{ flex: 1 }}
                      full={false}
                    />
                    {activeTopic && activeTopic.status !== "mastered" ? (
                      <Button
                        label="New set"
                        onPress={continueWithNew}
                        loading={starting}
                        icon={<Play size={15} color={colors.primaryFg} />}
                        style={{ flex: 1 }}
                        full={false}
                      />
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </MainTabContainer>
  );
}

// ─── Flashcard runner (separate full-screen view) ──────────────────────────

function FlashcardRunner({
  topicTitle,
  cards,
  index,
  flipped,
  onFlip,
  onNext,
  onPrev,
  onExit,
  scrollPad,
  cardsLength,
}: {
  topicTitle: string;
  cards: GeneratedFlashcard[];
  index: number;
  flipped: boolean;
  onFlip: () => void;
  onNext: () => void;
  onPrev: () => void;
  onExit: () => void;
  scrollPad: { paddingBottom: number };
  cardsLength: number;
}) {
  const card = cards[index];
  const grounded = Array.isArray(card?.source_refs) && card.source_refs.length > 0;
  return (
    <ScreenContainer swipeBack onBack={onExit}>
      <TopBar title="Flashcards" onBack={onExit} />
      <ScrollView contentContainerStyle={[styles.scroll, scrollPad]} showsVerticalScrollIndicator={false}>
        <Text style={styles.kickerText}>{topicTitle.toUpperCase()}</Text>
        <Text style={styles.flashCounter}>
          {index + 1} / {cardsLength}
        </Text>

        <Pressable onPress={onFlip} style={[styles.flashCard, flipped && styles.flashCardBack]}>
          <Text style={styles.flashFace}>{flipped ? "ANSWER" : "PROMPT"}</Text>
          <Text style={styles.flashContent}>{flipped ? card?.back : card?.front}</Text>
          {grounded ? (
            <Text style={styles.flashSource}>{sourceText(card.source_refs)}</Text>
          ) : null}
          <Text style={styles.flashHint}>Tap to {flipped ? "see prompt" : "reveal answer"}</Text>
        </Pressable>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 18 }}>
          <Button
            label="Previous"
            variant="secondary"
            onPress={onPrev}
            disabled={index === 0}
            style={{ flex: 1 }}
            full={false}
          />
          <Button
            label={index === cardsLength - 1 ? "Done" : "Next"}
            onPress={index === cardsLength - 1 ? onExit : onNext}
            style={{ flex: 1 }}
            full={false}
          />
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

// ─── Small presentational pieces ──────────────────────────────────────────

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHead}>
      {icon}
      <Text style={styles.sectionHeadText}>{title}</Text>
    </View>
  );
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pill, active ? styles.pillActive : styles.pillIdle]}>
      <Text style={[styles.pillLabel, { color: active ? colors.primaryFg : colors.muted }]}>{label}</Text>
    </Pressable>
  );
}

function TopicPhase({
  topic,
  index,
  last,
  selected,
  onPress,
}: {
  topic: TopicRow;
  index: number;
  last: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const mastery = Math.round(Number(topic.mastery_score || 0));
  const done = topic.status === "mastered";
  return (
    <View style={styles.phaseRow}>
      <View style={styles.rail}>
        {!last ? <View style={styles.railLine} /> : null}
        <View style={[styles.node, done ? styles.nodeSolid : styles.nodeIdle]}>
          {done ? (
            <Check size={14} color={colors.primaryFg} />
          ) : (
            <Text style={styles.nodeNum}>{index + 1}</Text>
          )}
        </View>
      </View>
      <Pressable onPress={onPress} style={[styles.phaseCard, selected && styles.phaseCardHi]}>
        <View style={styles.phaseHead}>
          <Text style={styles.phaseEyebrow}>PHASE {(index + 1).toString().padStart(2, "0")}</Text>
          <Tag
            label={STATUS_LABEL[topic.status].toUpperCase()}
            tone={done ? "success" : selected ? "solid" : "neutral"}
          />
        </View>
        <Text style={styles.phaseTitle}>{topic.title}</Text>
        {topic.summary ? (
          <Text style={styles.phaseDesc} numberOfLines={3}>
            {topic.summary}
          </Text>
        ) : null}
        <Text style={styles.phaseSource}>{sourceText(topic.source_refs)}</Text>
        <View style={styles.phaseProgress}>
          <ProgressBar value={mastery} style={{ flex: 1 }} />
          <Text style={styles.phasePct}>{mastery}%</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  kickerText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: colors.accent },
  h1: { fontFamily: fonts.soraSemibold, fontSize: 27, color: colors.text, lineHeight: 32, marginTop: 2 },
  metricsRow: { flexDirection: "row", gap: 8 },
  metric: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingVertical: 12,
    alignItems: "center",
  },
  metricValue: { color: colors.text, fontSize: 19, fontFamily: fonts.soraSemibold },
  metricLabel: { color: colors.mutedDim, fontSize: 10.5, fontFamily: fonts.mono, marginTop: 3, letterSpacing: 0.5 },
  schemaCard: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
    padding: 16,
  },
  schemaTitle: { color: colors.danger, fontSize: 14, fontFamily: fonts.bodySemibold },
  schemaBody: { color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 19, fontFamily: fonts.body },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionHeadText: { color: colors.text, fontSize: 16, fontFamily: fonts.soraSemibold },
  sourcesHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 8,
  },
  sourcesLabel: { color: colors.mutedDim, fontSize: 10.5, fontFamily: fonts.mono, letterSpacing: 1 },
  sourcesCount: { color: colors.mutedDim, fontSize: 11, fontFamily: fonts.body },
  uploadLink: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: 14 },
  uploadLinkText: { color: colors.accent, fontSize: 14, fontFamily: fonts.bodyMedium },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  rowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rowIdle: { borderColor: colors.border, backgroundColor: colors.surfaceLowest },
  docName: { color: colors.text, fontSize: 14, fontFamily: fonts.bodyMedium },
  docFolder: { color: colors.mutedDim, fontSize: 12, marginTop: 2, fontFamily: fonts.body },
  planRow: { borderRadius: radius.md, borderWidth: 1, paddingVertical: 11, paddingHorizontal: 12 },
  planTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  planType: { color: colors.mutedDim, fontSize: 11, marginTop: 2, fontFamily: fonts.mono },
  roadmapHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  roadmapTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.soraSemibold },
  roadmapMeta: { color: colors.muted, fontSize: 12, marginTop: 2, fontFamily: fonts.body },
  masteredPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  masteredText: { color: colors.text, fontSize: 13, fontFamily: fonts.bodySemibold },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  progressLabel: { color: colors.muted, fontSize: 12, fontFamily: fonts.body },
  progressValue: { color: colors.text, fontSize: 12, fontFamily: fonts.bodySemibold },
  timeline: { marginTop: 16 },
  phaseRow: { flexDirection: "row", gap: 12 },
  rail: { width: 28, alignItems: "center" },
  railLine: { position: "absolute", top: 16, bottom: -4, width: 2, backgroundColor: colors.border },
  node: { width: 28, height: 28, borderRadius: 999, alignItems: "center", justifyContent: "center", marginTop: 2 },
  nodeSolid: { backgroundColor: colors.primary },
  nodeIdle: { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border },
  nodeNum: { fontFamily: fonts.mono, fontSize: 12, color: colors.muted },
  phaseCard: { flex: 1, backgroundColor: colors.surfaceLowest, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, marginBottom: 14 },
  phaseCardHi: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  phaseHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  phaseEyebrow: { fontFamily: fonts.mono, fontSize: 9.5, letterSpacing: 0.8, color: colors.mutedDim },
  phaseTitle: { fontFamily: fonts.soraSemibold, fontSize: 16, color: colors.text },
  phaseDesc: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedDim, lineHeight: 19, marginTop: 5 },
  phaseSource: { fontFamily: fonts.body, fontSize: 11.5, color: colors.mutedDim, marginTop: 8, fontStyle: "italic" },
  phaseProgress: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  phasePct: { color: colors.text, fontSize: 12, fontFamily: fonts.bodySemibold },
  topicBrief: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceLowest, padding: 12, marginBottom: 4 },
  topicBriefTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  topicBriefBody: { color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 19, fontFamily: fonts.body },
  configLabel: { color: colors.mutedDim, fontSize: 10.5, fontFamily: fonts.mono, letterSpacing: 1, marginTop: 16, marginBottom: 8 },
  pillRow: { flexDirection: "row", gap: 8 },
  pill: { flex: 1, borderRadius: radius.full, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  pillActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  pillIdle: { borderColor: colors.border, backgroundColor: "transparent" },
  pillLabel: { fontSize: 12.5, fontFamily: fonts.bodySemibold, textTransform: "capitalize" },
  modeHint: { color: colors.mutedDim, fontSize: 11.5, marginTop: 8, fontFamily: fonts.body },
  // Session
  sessionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  sessionTitle: { fontFamily: fonts.soraSemibold, fontSize: 20, color: colors.text, marginTop: 2 },
  timerPill: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingVertical: 7, paddingHorizontal: 14 },
  timerText: { fontFamily: fonts.mono, fontSize: 14, color: colors.accent },
  qCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  qMeta: { color: colors.mutedDim, fontSize: 10.5, fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" },
  qPrompt: { color: colors.text, fontSize: 15, fontFamily: fonts.bodyMedium, marginTop: 8, lineHeight: 21 },
  sourceTag: { flexDirection: "row", gap: 6, marginTop: 10, borderRadius: radius.sm, backgroundColor: colors.accentSoft, paddingVertical: 6, paddingHorizontal: 9 },
  sourceTagText: { flex: 1, color: colors.muted, fontSize: 12, fontFamily: fonts.body },
  warnTag: { flexDirection: "row", gap: 6, marginTop: 10, borderRadius: radius.sm, backgroundColor: colors.warningSoft, paddingVertical: 6, paddingHorizontal: 9 },
  warnTagText: { flex: 1, color: colors.warning, fontSize: 12, fontFamily: fonts.bodyMedium },
  optionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: radius.md, borderWidth: 1, paddingVertical: 11, paddingHorizontal: 12 },
  optionCorrect: { borderColor: colors.success, backgroundColor: colors.successSoft },
  optionWrong: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
  optionId: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold, textTransform: "uppercase" },
  optionText: { flex: 1, color: colors.text, fontSize: 14, fontFamily: fonts.body },
  qFeedback: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 },
  qFeedbackTag: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 0.8 },
  qFeedbackText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 5, fontFamily: fonts.body },
  reviewCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.accent, backgroundColor: colors.accentSoft, padding: 16 },
  reviewHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  reviewLabel: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  reviewScore: { color: colors.accent, fontSize: 18, fontFamily: fonts.soraSemibold },
  reviewCoaching: { color: colors.muted, fontSize: 13.5, lineHeight: 20, fontFamily: fonts.body },
  // Flashcards
  flashCounter: { fontFamily: fonts.mono, fontSize: 12, color: colors.mutedDim, marginTop: 4 },
  flashCard: { marginTop: 16, minHeight: 280, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 22, justifyContent: "center", alignItems: "center", gap: 12 },
  flashCardBack: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  flashFace: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: colors.mutedDim },
  flashContent: { fontFamily: fonts.soraMedium, fontSize: 20, color: colors.text, textAlign: "center", lineHeight: 28 },
  flashSource: { fontFamily: fonts.body, fontSize: 11.5, color: colors.mutedDim, textAlign: "center", fontStyle: "italic" },
  flashHint: { fontFamily: fonts.mono, fontSize: 10, color: colors.mutedDim, marginTop: 8 },
});
