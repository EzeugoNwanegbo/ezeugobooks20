// G&D — Battle Royale: the host-side setup, play and result screen for an
// async friend match.
//
// Replaces the old "New challenge" sheet in friends.tsx (pick one of your own
// unfinished MCQ sets and send it). Here the host configures a FRESH match —
// which file (or roadmap), scope, question count, difficulty, how long to
// finish, whole-file vs roadmap format — this screen builds it, sends it, and
// then the host plays their own set right here: setup -> play -> result. It
// is deliberately "a different type of My Coach": same document picking and
// scope pattern as coach.tsx's roadmap builder, and the play view is modelled
// on coach.tsx's session runner, but this is its own local UI (coach.tsx is
// owned by another change in flight).
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS — see lib/battle-royale-client.ts for why
// both are non-negotiable (brief + the challenge_create() RPC's own guard).
// This screen adds a difficulty picker but deliberately no question-type
// picker: the whole point of a fair, gradeable contest is that both players
// answer the same graded shape, and that shape is fixed.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  Clock,
  FileText,
  Lock,
  Map as MapIcon,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  Swords,
  Trophy,
  Users,
} from "lucide-react-native";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ComingSoon } from "@/components/coming-soon";
import { toast } from "@/components/toast";
import { Button, EmptyState, Field, ProgressBar, Tag } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  BATTLE_MAX_MINUTES,
  BATTLE_MAX_QUESTIONS,
  BATTLE_MIN_MINUTES,
  BATTLE_MIN_QUESTIONS,
  BATTLE_SCHEMA_APPLIED,
  type BattleProgress,
  createBattleSession,
  createRoadmapBattleSeries,
  type DocRow,
  folderName,
  loadBattleDocuments,
  loadBattlePlans,
  loadPlanTopics,
  type RoadmapRoundResult,
} from "@/lib/battle-royale-client";
import {
  db,
  type DifficultyLevel,
  formatClock,
  type PlanRow,
  type QuestionRow,
  type SessionRow,
  type TopicRow,
} from "@/lib/studybody-data";
import { reviewStudyAnswers } from "@/lib/studybody-client";
import {
  type ChallengeSummary,
  friendList,
  listChallenges,
  socialEnabled,
  submitChallengeForSession,
  type Friend,
} from "@/lib/social";
import { colors, fonts, radius } from "@/lib/theme";
import { BOTTOM_NAV_HEIGHT, MainTabContainer, TopBar, useDrawer, useHaptics } from "@/platform";

type Scope = "whole" | "topic";
type Format = "single" | "roadmap";
type ScreenMode = "setup" | "play" | "result";

// Offered per the brief. Which of these are reachable depends on
// BATTLE_MAX_QUESTIONS, which tracks BATTLE_SCHEMA_APPLIED: with the migration
// unapplied the server's cap is 12, so only 10 fits and the other two are shown
// (the design is real) but disabled rather than wired to a call that
// challenge_create() would refuse AFTER the AI spend had already happened. Once
// it is applied the DB/edge-function ceiling widens to 100, but
// BATTLE_MAX_QUESTIONS itself only opens to 50 — see its own comment in
// lib/battle-royale-client.ts for why that number, not 100, is what this
// screen actually offers. All three presets below fit under 50 either way.
const COUNT_PRESETS = [10, 20, 30] as const;
const DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard"];

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Mirrors coach.tsx's own private helper: which AI correction voice to use. */
function correctionMode(preferred: string | null | undefined): "Simplified" | "Detailed" | "Storytelling" {
  return preferred === "Detailed" ? "Detailed" : preferred === "Storytelling" ? "Storytelling" : "Simplified";
}

// Carries a roadmap series through play -> result -> the next round, entirely
// in memory: every round was already built and sent by the time the host
// starts playing round 1, so "play the next round" needs no new query.
type PlayRoadmapCtx = {
  seriesId: string;
  totalRounds: number;
  completedRounds: number;
  currentRound: number;
  /** Sent rounds not currently being played, in order. */
  otherRounds: RoadmapRoundResult[];
};

type PlayState = {
  session: SessionRow;
  questions: QuestionRow[];
  challengeId: string;
  answers: Record<string, string>;
  durationSeconds: number;
  submitting: boolean;
  roadmap?: PlayRoadmapCtx;
};

type ResultState = {
  challengeId: string;
  questionCount: number;
  loading: boolean;
  summary: ChallengeSummary | null;
  roadmap?: PlayRoadmapCtx;
};

// ── Resuming an unstarted or half-played battle ─────────────────────────────
//
// buildQuestionSet (battle-royale-client.ts) writes the study_sessions row and
// its study_questions BEFORE the host plays a single question, and
// challenge_create() has already run by the time enterPlay() is first called
// — so the data survives a host who leaves mid-setup-to-play, or leaves
// mid-play via "Leave" below. What was missing was any way BACK to it: this
// screen had no query for it at all, unlike coach.tsx's own `resumable`
// (see its useEffect around line 274), which this mirrors.
//
// Found via TWO reads, not one: study_sessions for the host's own in-progress
// Battle Royale sessions (feedback.battle_royale === true, stamped by
// buildQuestionSet), joined in memory against listChallenges() for the
// opponent identity, title and live status — the same RPC the Result view
// already calls, so this adds no new server surface. A session whose SEND
// itself was interrupted before challenge_create() ever ran (no
// feedback.challenge_id yet) is deliberately NOT offered back here: it has no
// challenge to resume into, and the only way forward for it is what the setup
// screen already does — configure and send a fresh one. That is a real,
// accepted gap, not an oversight — see the report this shipped with.
type ResumableBattle = {
  sessionId: string;
  challengeId: string;
  title: string;
  opponentUserId: string;
  opponentUsername: string;
  opponentName: string;
  totalQuestions: number;
  timeLimitMinutes: number;
};

export default function BattleRoyaleScreen() {
  const { open } = useDrawer();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const params = useLocalSearchParams<{
    friendId?: string;
    friendUsername?: string;
    friendName?: string;
  }>();

  // Arrived from Friends' "Battle" button with a target already chosen — back
  // returns there. Arrived from the bottom tab directly — this is a main tab
  // like its three siblings, so the affordance matches theirs (menu, not back).
  const cameWithOpponent = Boolean(params.friendUsername);

  const enabled = socialEnabled(user);

  // ── Opponent ────────────────────────────────────────────────────────────
  const [opponent, setOpponent] = useState<{ userId: string; username: string; name: string } | null>(
    params.friendUsername
      ? {
          userId: params.friendId ?? "",
          username: params.friendUsername,
          name: params.friendName ?? params.friendUsername,
        }
      : null,
  );
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || opponent) return;
    setFriendsLoading(true);
    void friendList()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setFriendsLoading(false));
  }, [enabled, opponent]);

  // A friend who never claimed a handle cannot be the target of challenge_create
  // (it takes a username, not a uuid) — the same guard friends.tsx applies
  // before opening its old sheet.
  const challengeableFriends = useMemo(() => friends.filter((f) => f.username), [friends]);

  // ── Setup state ─────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("whole");
  const [topicFocus, setTopicFocus] = useState("");
  const [format, setFormat] = useState<Format>("single");
  const [difficulty, setDifficulty] = useState<DifficultyLevel>("medium");

  const [countPreset, setCountPreset] = useState<number | "custom">(10);
  const [customCount, setCustomCount] = useState(String(BATTLE_MAX_QUESTIONS));
  const [minutes, setMinutes] = useState("15");

  // Roadmap picking — same tables coach.tsx's own roadmap switcher reads, but
  // this screen never builds a roadmap, only lists existing ones.
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planTopics, setPlanTopics] = useState<TopicRow[]>([]);
  const [planTopicsLoading, setPlanTopicsLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<BattleProgress | null>(null);

  // ── Play / result state ────────────────────────────────────────────────
  const [mode, setMode] = useState<ScreenMode>("setup");
  const [playState, setPlayState] = useState<PlayState | null>(null);
  const [resultState, setResultState] = useState<ResultState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const playStartRef = useRef(0);
  // The session's feedback minus draftAnswers, kept so the debounced autosave
  // below never clobbers mode/difficulty/time_limit_minutes — same shape
  // coach.tsx's feedbackBaseRef plays.
  const feedbackBaseRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (!user) return;
    setDocsLoading(true);
    loadBattleDocuments(user.id)
      .then(setDocs)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load your files"))
      .finally(() => setDocsLoading(false));
  }, [user]);

  // Roadmaps load lazily, only once the format is actually picked — no reason
  // to hit study_plans for a host who never opens that door.
  useEffect(() => {
    if (!BATTLE_SCHEMA_APPLIED || format !== "roadmap" || !user || plans.length || plansLoading) return;
    setPlansLoading(true);
    loadBattlePlans(user.id)
      .then(setPlans)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load your roadmaps"))
      .finally(() => setPlansLoading(false));
  }, [format, user, plans.length, plansLoading]);

  useEffect(() => {
    if (!selectedPlanId || !user) {
      setPlanTopics([]);
      return;
    }
    setPlanTopicsLoading(true);
    loadPlanTopics(user.id, selectedPlanId)
      .then(setPlanTopics)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load that roadmap's topics"))
      .finally(() => setPlanTopicsLoading(false));
  }, [selectedPlanId, user]);

  // Exam-mode timer, while actually playing.
  useEffect(() => {
    if (mode !== "play") return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - playStartRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [mode]);

  // Debounced autosave of in-progress answers, mirroring coach.tsx, so a
  // half-played set resumes in place if the host leaves and comes back.
  useEffect(() => {
    if (mode !== "play" || !playState) return;
    const id = setTimeout(() => {
      void db
        .from("study_sessions")
        .update({ feedback: { ...feedbackBaseRef.current, draftAnswers: playState.answers } })
        .eq("id", playState.session.id);
    }, 800);
    return () => clearTimeout(id);
  }, [playState?.answers, mode, playState?.session.id]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  // The resolved question count this match will actually be built with — a
  // preset already inside the server cap, or whatever survives clamping the
  // custom field. Bounds: BATTLE_MIN_QUESTIONS (3 — a 1-2 question match is not
  // really a contest) to BATTLE_MAX_QUESTIONS (12 — challenge_create()'s own
  // hard ceiling). A blank, zero, negative or absurd ("5000") custom entry all
  // resolve inside that range rather than reaching session creation.
  const resolvedCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const parsed = parseInt(customCount, 10);
    return clampInt(parsed, BATTLE_MIN_QUESTIONS, BATTLE_MAX_QUESTIONS);
  }, [countPreset, customCount]);

  const resolvedMinutes = useMemo(() => {
    const parsed = parseInt(minutes, 10);
    return clampInt(parsed, BATTLE_MIN_MINUTES, BATTLE_MAX_MINUTES);
  }, [minutes]);

  const explainRoadmapLocked = useCallback(() => {
    Alert.alert(
      "Roadmap battles are coming soon",
      "A multi-stage battle with a win for each roadmap topic needs a database change that hasn't shipped yet. For now every Battle Royale match is a single, whole-file round.",
    );
  }, []);

  const roadmapDocIds = selectedPlan?.source_document_ids?.length ? selectedPlan.source_document_ids : [];

  const canSend =
    enabled &&
    Boolean(opponent) &&
    !sending &&
    (format === "single"
      ? Boolean(selectedDoc) && (scope === "whole" || topicFocus.trim().length > 0)
      : BATTLE_SCHEMA_APPLIED && Boolean(selectedPlan) && planTopics.length > 0 && roadmapDocIds.length > 0);

  // ── Entering play / result ─────────────────────────────────────────────

  const enterPlay = useCallback(
    (args: {
      session: SessionRow;
      questions: QuestionRow[];
      challengeId: string;
      timeLimitMinutes: number;
      roadmap?: PlayRoadmapCtx;
    }) => {
      const fb = (args.session.feedback ?? {}) as { draftAnswers?: Record<string, string>; time_limit_minutes?: number } & Record<
        string,
        unknown
      >;
      const { draftAnswers, ...base } = fb;
      feedbackBaseRef.current = base;
      const minutesInEffect = typeof fb.time_limit_minutes === "number" ? fb.time_limit_minutes : args.timeLimitMinutes;
      setPlayState({
        session: args.session,
        questions: args.questions,
        challengeId: args.challengeId,
        answers: draftAnswers ?? {},
        durationSeconds: Math.max(0, Math.round(minutesInEffect * 60)),
        submitting: false,
        roadmap: args.roadmap,
      });
      playStartRef.current = Date.now();
      setElapsed(0);
      setResultState(null);
      setMode("play");
    },
    [],
  );

  const refreshResultFor = useCallback(async (challengeId: string) => {
    try {
      const list = await listChallenges();
      const summary = list.find((c) => c.id === challengeId) ?? null;
      setResultState((cur) => (cur ? { ...cur, summary, loading: false } : cur));
    } catch {
      setResultState((cur) => (cur ? { ...cur, loading: false } : cur));
      toast.error("Could not load the result — tap Refresh to try again.");
    }
  }, []);

  const enterResult = useCallback(
    async (challengeId: string, questionCount: number, roadmap?: PlayRoadmapCtx) => {
      setPlayState(null);
      setResultState({ challengeId, questionCount, loading: true, summary: null, roadmap });
      setMode("result");
      await refreshResultFor(challengeId);
    },
    [refreshResultFor],
  );

  const refreshResult = () => {
    if (!resultState) return;
    setResultState((cur) => (cur ? { ...cur, loading: true } : cur));
    void refreshResultFor(resultState.challengeId);
  };

  const backToSetup = () => {
    setMode("setup");
    setPlayState(null);
    setResultState(null);
  };

  const confirmLeavePlay = () => {
    Alert.alert(
      "Leave this battle?",
      "It has already been sent and your answers so far are saved — you can come back and finish from your challenges later.",
      [
        { text: "Keep playing", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: backToSetup },
      ],
    );
  };

  // ── Sending ─────────────────────────────────────────────────────────────

  const send = async () => {
    if (!user || !profile || !opponent) return;

    if (format === "single") {
      if (!selectedDoc) return;
      if (scope === "topic" && !topicFocus.trim()) {
        toast.error("Type the topic this battle should focus on, or switch to the whole file.");
        return;
      }
      setSending(true);
      setProgress(null);
      try {
        const result = await createBattleSession({
          userId: user.id,
          profile,
          doc: selectedDoc,
          scope,
          topicFocus,
          count: resolvedCount,
          timeLimitMinutes: resolvedMinutes,
          difficulty,
          opponentUsername: opponent.username,
          onProgress: setProgress,
        });
        haptics.success();
        toast.success(`Battle sent to @${opponent.username}.`);
        enterPlay({
          session: result.session,
          questions: result.questions,
          challengeId: result.challengeId,
          timeLimitMinutes: resolvedMinutes,
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send that battle");
      } finally {
        setSending(false);
        setProgress(null);
      }
      return;
    }

    // Roadmap.
    if (!selectedPlan || !planTopics.length || !roadmapDocIds.length) return;
    const docsMeta = docs.filter((d) => roadmapDocIds.includes(d.id));
    setSending(true);
    setProgress(null);
    try {
      const result = await createRoadmapBattleSeries({
        userId: user.id,
        profile,
        opponentUsername: opponent.username,
        plan: selectedPlan,
        topics: planTopics,
        docIds: roadmapDocIds,
        docsMeta,
        count: resolvedCount,
        timeLimitMinutes: resolvedMinutes,
        difficulty,
        onProgress: setProgress,
      });

      if (!result.rounds.length) {
        // The series row exists (it is cheap and has no AI spend) but nothing
        // could be built — tell the host plainly rather than pretending
        // something sent.
        toast.error(
          result.failedAt
            ? `Could not build round 1: ${result.failedAt.error}`
            : "Could not build any rounds for that roadmap.",
        );
        return;
      }

      haptics.success();
      const [first, ...rest] = result.rounds;
      if (result.failedAt) {
        // A partly built series is explicitly allowed by the migration — say
        // so plainly rather than rolling anything back.
        Alert.alert(
          `Sent ${result.rounds.length} of ${result.totalRounds} rounds`,
          `Round ${result.failedAt.round} ("${result.failedAt.topicTitle}") could not be built — ` +
            `${result.failedAt.error} The ${result.rounds.length} round${result.rounds.length === 1 ? "" : "s"} ` +
            `that did send stand as a roadmap battle with @${opponent.username}.`,
        );
      } else {
        toast.success(
          `Roadmap battle sent — ${result.rounds.length} round${result.rounds.length === 1 ? "" : "s"} to @${opponent.username}.`,
        );
      }
      enterPlay({
        session: first.session,
        questions: first.questions,
        challengeId: first.challengeId,
        timeLimitMinutes: resolvedMinutes,
        roadmap: {
          seriesId: result.seriesId,
          totalRounds: result.totalRounds,
          completedRounds: result.rounds.length,
          currentRound: first.round,
          otherRounds: rest,
        },
      });
    } catch (err) {
      // challenge_series_create's own rate-limit message ("You already have a
      // roadmap battle running with this friend.") surfaces here untouched.
      toast.error(err instanceof Error ? err.message : "Could not send that roadmap battle");
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  // ── Playing ─────────────────────────────────────────────────────────────

  const pickAnswer = (q: QuestionRow, optionId: string) => {
    setPlayState((cur) => (cur ? { ...cur, answers: { ...cur.answers, [q.id]: optionId } } : cur));
    haptics.light();
  };

  const submitBattle = async () => {
    if (!user || !profile || !playState) return;
    const missing = playState.questions.filter((q) => !playState.answers[q.id]?.trim());
    if (missing.length) {
      toast.error("Answer every question before submitting.");
      return;
    }
    setPlayState((cur) => (cur ? { ...cur, submitting: true } : cur));
    try {
      const result = await reviewStudyAnswers({
        profile,
        mode: correctionMode(profile.preferred_mode),
        questions: playState.questions.map((q) => ({
          id: q.id,
          type: q.question_type,
          prompt: q.prompt,
          options: q.options ?? [],
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          rubric: q.rubric ?? [],
          source_refs: q.source_refs ?? [],
        })),
        answers: playState.answers,
      });

      const gradingAnswers = result.grading.answers ?? [];
      const answerRows = playState.questions.map((q, index) => {
        const grade = gradingAnswers.find((it) => it.question_id === q.id) ?? gradingAnswers[index] ?? {};
        return {
          user_id: user.id,
          question_id: q.id,
          session_id: playState.session.id,
          answer: playState.answers[q.id],
          is_correct: grade.is_correct ?? null,
          score: grade.score ?? null,
          feedback: grade.feedback ?? "",
          missing_points: grade.missing_points ?? [],
        };
      });

      const percentage = Math.round(Number(result.grading.percentage ?? 0));
      const timeTaken = Math.floor((Date.now() - playStartRef.current) / 1000);

      await db.from("study_answers").insert(answerRows);
      await db
        .from("study_sessions")
        .update({
          status: "completed",
          score: percentage,
          feedback: { ...feedbackBaseRef.current, ...result, time_taken_seconds: timeTaken },
          completed_at: new Date().toISOString(),
        })
        .eq("id", playState.session.id);

      // Must run AFTER the status update above — the RPC reads the completed
      // session back. This is the exact call that was missing before and made
      // challenges unfinishable: without it a student could play a challenge
      // through and have their score never register on the other side.
      await submitChallengeForSession(playState.session.id);

      haptics.success();
      await enterResult(playState.challengeId, playState.questions.length, playState.roadmap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit your answers");
      setPlayState((cur) => (cur ? { ...cur, submitting: false } : cur));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  if (!enabled) {
    return (
      <MainTabContainer>
        <TopBar title="Battle Royale" onMenu={cameWithOpponent ? undefined : open} onBack={cameWithOpponent ? () => router.back() : undefined} />
        <ComingSoon
          icon={<Swords size={30} color={colors.accent} />}
          title="Battle Royale"
          description="Async friend matches aren't switched on for everyone yet — they'll appear here once they are."
        />
      </MainTabContainer>
    );
  }

  const scrollPad = { paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 32 };

  const topBarTitle =
    mode === "play"
      ? playState?.roadmap
        ? `Round ${playState.roadmap.currentRound} of ${playState.roadmap.totalRounds}`
        : "Your battle"
      : mode === "result"
        ? "Result"
        : "Battle Royale";

  // Nothing here is dismissable mid-send: the Send button already disables
  // (via `sending` feeding into every branch below), and neither the menu nor
  // back is reachable while a set is half-built, so leaving can't strand a
  // half-written study_plans/topics/session/questions chain.
  const topBarOnMenu = sending || mode !== "setup" || opponent ? undefined : cameWithOpponent ? undefined : open;
  const topBarOnBack = sending
    ? undefined
    : mode === "play"
      ? confirmLeavePlay
      : mode === "result"
        ? backToSetup
        : cameWithOpponent
          ? () => router.back()
          : undefined;

  return (
    <MainTabContainer>
      <TopBar title={topBarTitle} onMenu={topBarOnMenu} onBack={topBarOnBack} />

      <ScrollView
        contentContainerStyle={[styles.scroll, scrollPad]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {mode === "play" && playState ? (
          <PlayView
            opponentUsername={opponent?.username ?? ""}
            playState={playState}
            elapsed={elapsed}
            onPick={pickAnswer}
            onSubmit={submitBattle}
          />
        ) : mode === "result" && resultState && opponent ? (
          <ResultView
            resultState={resultState}
            opponent={opponent}
            resolvedMinutes={resolvedMinutes}
            onRefresh={refreshResult}
            onPlayNextRound={enterPlay}
            onDone={backToSetup}
          />
        ) : !opponent ? (
          <>
            <View style={styles.kicker}>
              <Swords size={15} color={colors.accent} />
              <Text style={styles.kickerText}>BATTLE ROYALE</Text>
            </View>
            <Text style={styles.h1}>Who are you battling?</Text>
            <Text style={styles.sub}>
              Pick a friend to build a match for. Add friends from the Friends screen first if
              nobody shows up here.
            </Text>

            <View style={styles.card}>
              {friendsLoading ? (
                <EmptyState text="Loading your friends…" />
              ) : challengeableFriends.length === 0 ? (
                <EmptyState text="No friends ready to battle yet. Add one from the Friends screen." />
              ) : (
                <View style={{ gap: 8 }}>
                  {challengeableFriends.map((f) => (
                    <Pressable
                      key={f.user_id}
                      onPress={() => {
                        haptics.selection();
                        setOpponent({ userId: f.user_id, username: f.username as string, name: f.display_name });
                      }}
                      style={[styles.row, styles.rowIdle]}
                    >
                      <Users size={16} color={colors.accent} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {f.display_name}
                        </Text>
                        <Text style={styles.rowSubtitle}>@{f.username}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.kicker}>
              <Swords size={15} color={colors.accent} />
              <Text style={styles.kickerText}>SETTING UP A MATCH</Text>
            </View>
            <Text style={styles.h1}>Battle @{opponent.username}</Text>
            <Text style={styles.sub}>
              Exam mode only — nothing is revealed until you both finish. Configure it, then send.
            </Text>

            {/* Format */}
            <View style={styles.card}>
              <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Format" />
              <Pressable
                onPress={() => setFormat("single")}
                disabled={sending}
                style={[styles.formatRow, format === "single" ? styles.rowActive : styles.rowIdle]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>Whole-file overview</Text>
                  <Text style={styles.rowSubtitle}>One round. Finish it, see the result.</Text>
                </View>
                {format === "single" ? <Check size={16} color={colors.accent} /> : null}
              </Pressable>
              <Pressable
                onPress={BATTLE_SCHEMA_APPLIED ? () => setFormat("roadmap") : explainRoadmapLocked}
                disabled={sending}
                style={[
                  styles.formatRow,
                  BATTLE_SCHEMA_APPLIED ? (format === "roadmap" ? styles.rowActive : styles.rowIdle) : styles.rowDisabled,
                ]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>Roadmap</Text>
                  <Text style={styles.rowSubtitle}>A win for each roadmap topic.</Text>
                </View>
                {BATTLE_SCHEMA_APPLIED ? (
                  format === "roadmap" ? <Check size={16} color={colors.accent} /> : null
                ) : (
                  <>
                    <Tag label="SOON" tone="neutral" />
                    <Lock size={14} color={colors.mutedDim} style={{ marginLeft: 8 }} />
                  </>
                )}
              </Pressable>
            </View>

            {format === "single" ? (
              <>
                {/* File */}
                <View style={styles.card}>
                  <SectionHead icon={<FileText size={15} color={colors.accent} />} title="Which file" />
                  {docsLoading ? (
                    <EmptyState text="Loading your files…" />
                  ) : docs.length === 0 ? (
                    <EmptyState text="Upload a file in Library first." />
                  ) : (
                    <View style={{ gap: 8 }}>
                      {docs.map((doc) => {
                        const selected = selectedDocId === doc.id;
                        return (
                          <Pressable
                            key={doc.id}
                            onPress={() => {
                              haptics.selection();
                              setSelectedDocId(doc.id);
                            }}
                            style={[styles.row, selected ? styles.rowActive : styles.rowIdle]}
                          >
                            <FileText size={16} color={colors.accent} />
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text style={styles.rowTitle} numberOfLines={1}>
                                {doc.file_name}
                              </Text>
                              <Text style={styles.rowSubtitle}>{folderName(doc) || "Uncategorised"}</Text>
                            </View>
                            {selected ? <Check size={16} color={colors.accent} /> : null}
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* Scope */}
                {selectedDoc ? (
                  <View style={styles.card}>
                    <SectionHead icon={<FileText size={15} color={colors.accent} />} title="Scope" />
                    <View style={styles.pillRow}>
                      <Pill label="The whole file" active={scope === "whole"} onPress={() => setScope("whole")} />
                      <Pill label="A specific topic" active={scope === "topic"} onPress={() => setScope("topic")} />
                    </View>
                    {scope === "topic" ? (
                      <Field
                        value={topicFocus}
                        onChangeText={setTopicFocus}
                        placeholder="e.g. Cranial nerves, Consideration in contract law…"
                        style={{ marginTop: 10 }}
                      />
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : (
              /* Roadmap picker */
              <View style={styles.card}>
                <SectionHead icon={<MapIcon size={15} color={colors.accent} />} title="Which roadmap" />
                {plansLoading ? (
                  <EmptyState text="Loading your roadmaps…" />
                ) : plans.length === 0 ? (
                  <EmptyState text="Build a roadmap in My Coach first." />
                ) : (
                  <View style={{ gap: 8 }}>
                    {plans.map((plan) => {
                      const selected = selectedPlanId === plan.id;
                      return (
                        <Pressable
                          key={plan.id}
                          onPress={() => {
                            haptics.selection();
                            setSelectedPlanId(plan.id);
                          }}
                          style={[styles.row, selected ? styles.rowActive : styles.rowIdle]}
                        >
                          <MapIcon size={16} color={colors.accent} />
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>
                              {plan.title}
                            </Text>
                            <Text style={styles.rowSubtitle}>{plan.source_type}</Text>
                          </View>
                          {selected ? <Check size={16} color={colors.accent} /> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                )}

                {selectedPlan ? (
                  <View style={{ marginTop: 12 }}>
                    {planTopicsLoading ? (
                      <EmptyState text="Loading topics…" />
                    ) : planTopics.length === 0 ? (
                      <EmptyState text="This roadmap has no topics yet." />
                    ) : (
                      <>
                        <Text style={styles.hint}>
                          {planTopics.length} round{planTopics.length === 1 ? "" : "s"} — one battle per topic, a
                          win for each. @{opponent.username} sees them arrive one at a time as they're built.
                        </Text>
                        <View style={{ gap: 6, marginTop: 8 }}>
                          {planTopics.map((t, i) => (
                            <Text key={t.id} style={styles.roundListItem} numberOfLines={1}>
                              {i + 1}. {t.title}
                            </Text>
                          ))}
                        </View>
                      </>
                    )}
                    {!roadmapDocIds.length ? (
                      <View style={styles.hintRow}>
                        <AlertTriangle size={12} color={colors.mutedDim} style={{ marginTop: 1 }} />
                        <Text style={styles.hint}>This roadmap has no source files, so it can't be battled with yet.</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            )}

            {/* Question count */}
            <View style={styles.card}>
              <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Questions" />
              <View style={styles.pillRow}>
                {COUNT_PRESETS.map((n) => {
                  const overCap = n > BATTLE_MAX_QUESTIONS;
                  return (
                    <Pill
                      key={n}
                      label={n.toString()}
                      active={countPreset === n}
                      disabled={overCap}
                      onPress={() => (overCap ? undefined : setCountPreset(n))}
                    />
                  );
                })}
                <Pill label="Custom" active={countPreset === "custom"} onPress={() => setCountPreset("custom")} />
              </View>
              {countPreset === "custom" ? (
                <Field
                  value={customCount}
                  onChangeText={setCustomCount}
                  keyboardType="number-pad"
                  placeholder={`${BATTLE_MIN_QUESTIONS}-${BATTLE_MAX_QUESTIONS}`}
                  style={{ marginTop: 10 }}
                />
              ) : null}
              {/* Two different truths, and the screen must not tell the wrong one:
                  with the migration unapplied the cap really is 12 and the bigger
                  presets really are unreachable; once it lands they simply work,
                  and an apology for a limit that no longer exists reads as a bug. */}
              <View style={styles.hintRow}>
                <AlertTriangle size={12} color={colors.mutedDim} style={{ marginTop: 1 }} />
                <Text style={styles.hint}>
                  {BATTLE_SCHEMA_APPLIED
                    ? `Battles run up to ${BATTLE_MAX_QUESTIONS} questions — the largest set worth ` +
                      `attempting against how long the AI takes to write one. This match will use ${resolvedCount}${format === "roadmap" ? " per round" : ""}.`
                    : `Battles are capped at ${BATTLE_MAX_QUESTIONS} questions for now — that is the ` +
                      `server's own limit for a fair, gradeable contest. 20 and 30 will unlock once ` +
                      `that cap is raised. This match will use ${resolvedCount}.`}
                </Text>
              </View>
            </View>

            {/* Difficulty */}
            <View style={styles.card}>
              <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Difficulty" />
              <View style={styles.pillRow}>
                {DIFFICULTIES.map((d) => (
                  <Pill key={d} label={d} active={difficulty === d} onPress={() => setDifficulty(d)} />
                ))}
              </View>
            </View>

            {/* Time to finish */}
            <View style={styles.card}>
              <SectionHead icon={<Clock size={15} color={colors.accent} />} title="Time to finish" />
              <Field
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                placeholder="Minutes"
                style={{ marginTop: 2 }}
              />
              <Text style={styles.hint}>
                {BATTLE_MIN_MINUTES}-{BATTLE_MAX_MINUTES} minutes. This match will give
                {" "}{resolvedMinutes} min{format === "roadmap" ? " per round" : ""} — shown to your opponent, not force-submitted.
              </Text>
            </View>

            {sending ? (
              <View style={styles.card}>
                <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Building your battle" />
                <Text style={styles.progressLabel}>{progress?.label ?? "Starting…"}</Text>
                <ProgressBar value={(progress?.fraction ?? 0) * 100} style={{ marginTop: 10 }} />
                <Text style={styles.progressPct}>{Math.round((progress?.fraction ?? 0) * 100)}%</Text>
              </View>
            ) : null}

            <Button
              label={sending ? "Sending…" : format === "roadmap" ? `Send roadmap battle to @${opponent.username}` : `Send battle to @${opponent.username}`}
              onPress={send}
              disabled={!canSend}
              loading={sending}
              icon={<Send size={16} color={colors.primaryFg} />}
              style={{ marginTop: 4 }}
            />
            <Button
              label="Choose someone else"
              variant="secondary"
              onPress={() => setOpponent(null)}
              disabled={sending}
              style={{ marginTop: 10 }}
            />
          </>
        )}
      </ScrollView>
    </MainTabContainer>
  );
}

// ─── Play view ──────────────────────────────────────────────────────────────
//
// Modelled directly on coach.tsx's session runner, trimmed to what Battle
// Royale actually needs: MCQ only, exam mode only, so there is no per-question
// feedback path and no essay Field — showing the answer as it's picked, or
// grading a free-text answer instantly, would defeat the whole point of a
// contest that stays hidden until both sides finish.
function PlayView({
  opponentUsername,
  playState,
  elapsed,
  onPick,
  onSubmit,
}: {
  opponentUsername: string;
  playState: PlayState;
  elapsed: number;
  onPick: (q: QuestionRow, optionId: string) => void;
  onSubmit: () => void;
}) {
  const { questions, answers, submitting, roadmap, durationSeconds } = playState;
  return (
    <>
      <View style={styles.sessionHead}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.kickerText}>
            EXAM MODE{roadmap ? ` · ROUND ${roadmap.currentRound} OF ${roadmap.totalRounds}` : ""}
          </Text>
          <Text style={styles.sessionTitle} numberOfLines={1}>
            Battle vs @{opponentUsername}
          </Text>
        </View>
        {durationSeconds > 0 ? (
          <View style={styles.timerPill}>
            <Text style={styles.timerText}>
              {elapsed >= durationSeconds ? "Time up" : formatClock(durationSeconds - elapsed)}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ gap: 14 }}>
        {questions.map((q, index) => (
          <View key={q.id} style={styles.qCard}>
            <Text style={styles.qMeta}>
              MCQ · {index + 1}/{questions.length}
            </Text>
            <Text style={styles.qPrompt}>{q.prompt}</Text>
            <View style={{ gap: 8, marginTop: 12 }}>
              {(q.options ?? []).map((opt) => {
                const picked = answers[q.id] === opt.id;
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => onPick(q, opt.id)}
                    style={[styles.optionRow, picked ? styles.rowActive : styles.rowIdle]}
                  >
                    <Text style={styles.optionId}>{opt.id}</Text>
                    <Text style={styles.optionText}>{opt.text}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}

        <Button
          label="Submit & finish"
          onPress={onSubmit}
          loading={submitting}
          icon={<Send size={16} color={colors.primaryFg} />}
        />
      </View>
    </>
  );
}

// ─── Result view ────────────────────────────────────────────────────────────
//
// Reads challenge_list_mine() through lib/social.ts's listChallenges() — the
// SAME function friends.tsx already renders its scorelines from — rather than
// recomputing anything client-side. The release rule lives in that RPC (see
// its own comment in the migration): their_score/their_finished only appear
// once the caller has finished their own sitting, so "they haven't finished"
// is a real, expected state here, not a loading glitch.
function ResultView({
  resultState,
  opponent,
  resolvedMinutes,
  onRefresh,
  onPlayNextRound,
  onDone,
}: {
  resultState: ResultState;
  opponent: { userId: string; username: string; name: string };
  resolvedMinutes: number;
  onRefresh: () => void;
  onPlayNextRound: (args: {
    session: SessionRow;
    questions: QuestionRow[];
    challengeId: string;
    timeLimitMinutes: number;
    roadmap?: PlayRoadmapCtx;
  }) => void;
  onDone: () => void;
}) {
  const s = resultState.summary;
  const theyFinished = s?.their_finished ?? false;
  const outcome = s?.outcome ?? null;
  const roadmap = resultState.roadmap;
  const nextRound = roadmap?.otherRounds[0] ?? null;

  return (
    <>
      <View style={styles.kicker}>
        <Trophy size={15} color={colors.accent} />
        <Text style={styles.kickerText}>RESULT</Text>
      </View>
      <Text style={styles.h1}>{roadmap ? `Round ${roadmap.currentRound} of ${roadmap.totalRounds}` : "Your battle"}</Text>

      <View style={styles.card}>
        {resultState.loading && !s ? (
          <EmptyState text="Checking the result…" />
        ) : (
          <>
            <View style={styles.scoreRow}>
              <View style={styles.scoreTile}>
                <Text style={styles.scoreValue}>{s?.my_score ?? 0}</Text>
                <Text style={styles.scoreLabel}>You</Text>
              </View>
              <Text style={styles.scoreOf}>of {s?.question_count ?? resultState.questionCount}</Text>
              <View style={styles.scoreTile}>
                <Text style={[styles.scoreValue, !theyFinished && { color: colors.mutedDim }]}>
                  {theyFinished ? s?.their_score ?? 0 : "—"}
                </Text>
                <Text style={styles.scoreLabel}>@{opponent.username}</Text>
              </View>
            </View>

            {!theyFinished ? (
              <Text style={[styles.hint, { marginTop: 12 }]}>
                Waiting for @{opponent.username} to play their set — their score only shows once they finish.
              </Text>
            ) : outcome ? (
              <Tag
                label={outcome === "won" ? "YOU WON" : outcome === "lost" ? "YOU LOST" : "DRAW"}
                tone={outcome === "won" ? "success" : outcome === "lost" ? "neutral" : "warning"}
                style={{ marginTop: 12, alignSelf: "flex-start" }}
              />
            ) : null}

            <Button
              label="Refresh"
              variant="secondary"
              onPress={onRefresh}
              loading={resultState.loading}
              icon={<RefreshCw size={15} color={colors.text} />}
              style={{ marginTop: 14 }}
              full={false}
            />
          </>
        )}
      </View>

      {roadmap ? (
        <View style={styles.card}>
          <SectionHead icon={<MapIcon size={15} color={colors.accent} />} title="Roadmap series" />
          <Text style={styles.hint}>
            {roadmap.completedRounds} of {roadmap.totalRounds} round{roadmap.totalRounds === 1 ? "" : "s"} sent to
            @{opponent.username}.
          </Text>
          {nextRound ? (
            <Button
              label={`Play round ${nextRound.round}: ${nextRound.topicTitle}`}
              onPress={() =>
                onPlayNextRound({
                  session: nextRound.session,
                  questions: nextRound.questions,
                  challengeId: nextRound.challengeId,
                  timeLimitMinutes: resolvedMinutes,
                  roadmap: {
                    seriesId: roadmap.seriesId,
                    totalRounds: roadmap.totalRounds,
                    completedRounds: roadmap.completedRounds,
                    currentRound: nextRound.round,
                    otherRounds: roadmap.otherRounds.slice(1),
                  },
                })
              }
              icon={<Play size={16} color={colors.primaryFg} />}
              style={{ marginTop: 12 }}
            />
          ) : roadmap.completedRounds > 1 ? (
            <Text style={[styles.hint, { marginTop: 10 }]}>
              That was the last round you've played here — the rest (if any are still unplayed) are in Friends.
            </Text>
          ) : null}
        </View>
      ) : null}

      <Button
        label="Done"
        variant="secondary"
        onPress={onDone}
        icon={<ChevronLeft size={16} color={colors.text} />}
        style={{ marginTop: 4 }}
      />
    </>
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

function Pill({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.pill,
        active ? styles.pillActive : styles.pillIdle,
        disabled && styles.pillDisabled,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          { color: active ? colors.primaryFg : disabled ? colors.faint : colors.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  kickerText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: colors.accent },
  h1: { fontFamily: fonts.soraSemibold, fontSize: 26, color: colors.text, lineHeight: 31, marginTop: 2 },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.mutedDim, lineHeight: 20, marginTop: -4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionHeadText: { color: colors.text, fontSize: 16, fontFamily: fonts.soraSemibold },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  rowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rowIdle: { borderColor: colors.border, backgroundColor: colors.surfaceLowest },
  rowDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceLowest, opacity: 0.55, marginTop: 8 },
  rowTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  rowSubtitle: { color: colors.mutedDim, fontSize: 12, marginTop: 2, fontFamily: fonts.body },
  roundListItem: { color: colors.muted, fontSize: 12.5, fontFamily: fonts.body },
  formatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { flexGrow: 1, borderRadius: radius.full, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", minHeight: 44, justifyContent: "center" },
  pillActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  pillIdle: { borderColor: colors.border, backgroundColor: "transparent" },
  pillDisabled: { borderColor: colors.border, backgroundColor: "transparent", opacity: 0.4 },
  pillLabel: { fontSize: 12.5, fontFamily: fonts.bodySemibold, textTransform: "capitalize" },
  hintRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  hint: { flex: 1, color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.body, marginTop: 8 },
  progressLabel: { color: colors.text, fontSize: 13.5, fontFamily: fonts.bodyMedium },
  progressPct: { color: colors.mutedDim, fontSize: 11.5, fontFamily: fonts.mono, marginTop: 6, textAlign: "right" },
  // Play
  sessionHead: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 4 },
  sessionTitle: { fontFamily: fonts.soraSemibold, fontSize: 20, color: colors.text, marginTop: 2 },
  timerPill: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, paddingVertical: 7, paddingHorizontal: 14 },
  timerText: { fontFamily: fonts.mono, fontSize: 14, color: colors.accent },
  qCard: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, padding: 14 },
  qMeta: { color: colors.mutedDim, fontSize: 10.5, fontFamily: fonts.mono, letterSpacing: 0.5, textTransform: "uppercase" },
  qPrompt: { color: colors.text, fontSize: 15, fontFamily: fonts.bodyMedium, marginTop: 8, lineHeight: 21 },
  optionRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: radius.md, borderWidth: 1, paddingVertical: 11, paddingHorizontal: 12 },
  optionId: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold, textTransform: "uppercase" },
  optionText: { flex: 1, color: colors.text, fontSize: 14, fontFamily: fonts.body },
  // Result
  scoreRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 16 },
  scoreTile: { alignItems: "center", minWidth: 72 },
  scoreValue: { color: colors.text, fontSize: 32, fontFamily: fonts.soraSemibold },
  scoreLabel: { color: colors.mutedDim, fontSize: 11.5, fontFamily: fonts.mono, marginTop: 4, letterSpacing: 0.5 },
  scoreOf: { color: colors.mutedDim, fontSize: 12.5, fontFamily: fonts.body, marginTop: 18 },
});
