// Battle Royale: setup, play and result for an async friend match.
//
// Was setup-and-send only; this brings it up to parity with the mobile app's
// screen (gandd-mobile/app/(app)/battle-royale.tsx), which is the reference
// implementation for this feature. Four things this file adds on top of the
// original setup flow:
//   1. Roadmap format — a SERIES of challenges, one round per roadmap topic,
//      gated behind BATTLE_SCHEMA_APPLIED (see src/lib/social.ts).
//   2. A staged progress readout (retrieving/generating/saving/sending) that
//      reports real steps rather than a guessed percentage.
//   3. Playing the set in place right after it sends — the host's own
//      session IS the challenge's source session, so there is no reason to
//      send them anywhere else to play it.
//   4. A result view reading challenge_list_mine()'s server-decided outcome.
//
// Still replaces the old inline "New challenge" flow on the Friends page (pick
// one of your own unfinished MCQ sets and send it — see -app.friends-page.tsx's
// header comment). Here the host configures a FRESH match. Same document- and
// scope-picking idiom as My Coach's practice screen
// (-app.practice-page.tsx / ConfigView); the play view below is its own local
// UI in the same idiom (card panels, MCQ option rows) rather than a port of
// that screen's — Practice supports Learning mode, essays, flashcards and
// timers none of which apply here, and it is a file this build does not own.
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS. Two reasons converge on the same answer:
// the brief (a match that reveals each answer as it is picked is not a
// contest), and the schema (challenge_create() rejects the whole set if even
// one question is not MCQ — see supabase/migrations/
// 20260809120000_social_usernames_friends_async_challenges.sql). Generating
// anything else would either be pointless (challenge_create forces the
// session's feedback.mode to 'exam' the moment it is sent, regardless of what
// it was built with) or would make the RPC refuse the set after the AI spend
// already happened.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  FileText,
  Lock,
  Map as MapIcon,
  Play,
  RefreshCw,
  Send,
  Swords,
  Users,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StageProgress, type ProgressStage } from "@/components/stage-progress";
import { useAuth } from "@/lib/auth-context";
import {
  BATTLE_SCHEMA_APPLIED,
  MAX_CHALLENGE_QUESTIONS,
  friendList,
  listChallenges,
  socialEnabled,
  submitChallengeForSession,
  type ChallengeSummary,
  type Friend,
} from "@/lib/social";
import { db, folderName, type DocRow, type PlanRow, type QuestionRow, type SessionRow, type TopicRow } from "@/lib/studybody-data";
import { reviewStudyAnswers } from "@/lib/studybody-client";
import { formatClock } from "@/lib/timed-challenge";
import {
  buildBattleTitle,
  createRoadmapBattleSeries,
  createSingleBattle,
  loadBattlePlans,
  loadPlanTopics,
  type BattleProgressEvent,
  type BattleScope,
  type BattleStage,
  type RoadmapRoundResult,
} from "@/lib/battle-royale-client";

type Scope = BattleScope;
type Format = "single" | "roadmap";
type ScreenMode = "setup" | "play" | "result";

// Offered per the brief. 10 fits inside the server's currently-live challenge
// cap (BATTLE_MAX_QUESTIONS below); 20 and 30 do not while the migration is
// unapplied, so they are shown — the design is real — but disabled rather
// than wired to a call challenge_create() would refuse after the AI spend
// already happened.
const COUNT_PRESETS = [10, 20, 30] as const;

// Which of two numbers is live depends on BATTLE_SCHEMA_APPLIED:
//   flag off — challenges.question_count CHECK (BETWEEN 1 AND 12) plus
//              challenge_create()'s own "up to 12 questions" guard
//              (MAX_CHALLENGE_QUESTIONS, mirrored in src/lib/social.ts);
//   flag on  — both widened to 100 by 20260813120000_battle_royale.sql, which
//              is also where the studybody edge function's generation clamp
//              was raised to match. 100 IS what the server will build — but
//              BATTLE_MAX_QUESTIONS_POOLED below deliberately offers less
//              than that.
//
// 50, not 100: the owner's own ceiling, set after a 30-question battle was
// tried and aborted against the wall-clock budget this app does not control
// (a Supabase Edge Function caps around 150s on the free plan; the client
// gives up at STUDYBODY_TIMEOUT_MS in src/lib/studybody-client.ts). generate_
// questions streams now (see that file), which makes a stalled attempt
// degrade gracefully instead of losing everything, but streaming does not
// raise either ceiling — so 50 is the largest set judged worth attempting,
// not the largest the server can technically produce. A permissive server
// (100) under a restrictive client (50) is the safe direction to be wrong in;
// the DB CHECK and the edge function's own clamp are intentionally left at
// 100 rather than lowered to match.
const BATTLE_MAX_QUESTIONS_POOLED = 50;
const BATTLE_MAX_QUESTIONS = BATTLE_SCHEMA_APPLIED
  ? BATTLE_MAX_QUESTIONS_POOLED
  : MAX_CHALLENGE_QUESTIONS; // 12
// A 1- or 2-question "battle" is barely a contest, so 3 is the floor.
// Deliberately not tied to My Coach's own smallest preset (10): that number
// plus this cap while the flag is off would leave a 10-12 range and make the
// Custom field almost pointless.
const BATTLE_MIN_QUESTIONS = 3;

// There is no schema field that carries a time limit onto the OPPONENT's copy
// of the match while BATTLE_SCHEMA_APPLIED is false: challenge_begin() builds
// their session's feedback from scratch and carries nothing else over. So a
// per-match timer cannot be enforced today — not even one-sidedly for the
// host, since a limit only one player's client knew about would mean the two
// are not playing the same contest. What DOES reach both players is
// challenges.title, snapshotted once at challenge_create time — so the chosen
// limit rides in the title instead (see buildBattleTitle), a pace both are
// told rather than one anything stops them going over.
const BATTLE_MIN_MINUTES = 1;
const BATTLE_MAX_MINUTES = 180; // 3 hours — generous, but bounds a fat-fingered 5000

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// ── Staged progress ───────────────────────────────────────────────────────────
//
// Four real steps, in order, matching what src/lib/battle-royale-client.ts
// actually awaits: retrieving the material, generating the set, saving it,
// sending it. For a roadmap every stage is prefixed "Round N of M —" so the
// host can tell which of the series' AI calls is in flight, matching the
// brief's requested label shape exactly.
const STAGE_ORDER: readonly BattleStage[] = ["retrieving", "generating", "saving", "sending"];
const STAGE_LABEL: Record<BattleStage, string> = {
  retrieving: "Reading your material",
  generating: "Generating questions",
  saving: "Saving the match",
  sending: "Sending to your opponent",
};

// StageProgress's own design rule is "no invented percentage" - a guessed
// fraction with nothing behind it is worse than no bar at all. This note is
// not a guess: generate_questions streams (see battle-royale-client.ts's own
// comment on BattleStage) an SSE frame the instant each server-side batch of
// questions finishes, carrying an exact "made X of Y" count, which is exactly
// the kind of real, non-interpolated fact that rule is asking for. Before the
// first batch has landed there is nothing real to say yet, so the note falls
// back to the honest "still working" line rather than showing "0 of Y".
function progressStages(event: BattleProgressEvent | null): ProgressStage[] {
  const prefix = event?.round ? `Round ${event.round.index} of ${event.round.total} — ` : "";
  const generatingNote =
    event?.stage === "generating" && typeof event.made === "number" && typeof event.target === "number"
      ? `${event.made} of ${event.target} questions written so far.`
      : "The long part — larger sets take a little longer.";
  return STAGE_ORDER.map((stage) => ({
    key: stage,
    label: prefix + STAGE_LABEL[stage],
    note: stage === "generating" ? generatingNote : undefined,
  }));
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

export function BattleRoyalePage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/battle-royale" }) as {
    friendId?: string;
    friendUsername?: string;
    friendName?: string;
  };

  // Arrived from Friends' "Battle" button with a target already chosen.
  const cameWithOpponent = Boolean(search.friendUsername);
  const enabled = socialEnabled(user);

  // ── Opponent ──────────────────────────────────────────────────────────────
  const [opponent, setOpponent] = useState<{
    userId: string;
    username: string;
    name: string;
  } | null>(
    search.friendUsername
      ? {
          userId: search.friendId ?? "",
          username: search.friendUsername,
          name: search.friendName ?? search.friendUsername,
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

  // A friend who never claimed a handle cannot be the target of createChallenge
  // (it sends by username, not id) — the same guard the old challenge dialog
  // applied before opening.
  const challengeableFriends = useMemo(() => friends.filter((f) => f.username), [friends]);

  // ── Setup state ───────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("whole");
  const [topicFocus, setTopicFocus] = useState("");
  const [format, setFormat] = useState<Format>("single");

  const [countPreset, setCountPreset] = useState<number | "custom">(10);
  const [customCount, setCustomCount] = useState(String(BATTLE_MAX_QUESTIONS));
  const [minutes, setMinutes] = useState("15");

  // Roadmap picking — same tables My Coach's own practice screen reads, but
  // this screen never builds a roadmap, only lists existing ones.
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [planTopics, setPlanTopics] = useState<TopicRow[]>([]);
  const [planTopicsLoading, setPlanTopicsLoading] = useState(false);

  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState<BattleProgressEvent | null>(null);
  const [stageError, setStageError] = useState<string | null>(null);

  // ── Play / result state ────────────────────────────────────────────────────
  const [mode, setMode] = useState<ScreenMode>("setup");
  const [playState, setPlayState] = useState<PlayState | null>(null);
  const [resultState, setResultState] = useState<ResultState | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const playStartRef = useRef(0);
  // The session's feedback minus draftAnswers, kept so the debounced autosave
  // below never clobbers mode/difficulty/time_limit_minutes — the same shape
  // -app.practice-page.tsx's own autosave plays against `session.feedback`.
  const feedbackBaseRef = useRef<Record<string, unknown>>({});

  // Sending is genuinely slow (a full-size battle is several sequential AI
  // calls, a roadmap is that per round) and half-built state — a series row
  // with some rounds sent, a challenge with no source_session_id yet — is not
  // something a mid-flight page-leave should be able to strand further than
  // it already is. Blocks in-app navigation AND a tab close/reload while
  // `sending` is true; does nothing once it settles either way.
  useBlocker({
    shouldBlockFn: () => sending,
    enableBeforeUnload: () => sending,
  });

  useEffect(() => {
    if (!user) return;
    let active = true;
    setDocsLoading(true);
    (async () => {
      const { data, error } = await db
        .from("documents")
        .select("id, file_name, extracted_text, folder_id, folders(name)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (!active) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      setDocs((data as DocRow[]) ?? []);
    })().finally(() => {
      if (active) setDocsLoading(false);
    });
    return () => {
      active = false;
    };
  }, [user]);

  // Roadmaps load lazily, only once the format is actually picked — no reason
  // to hit study_plans for a host who never opens that door. Guarded on the
  // flag too, belt and braces: the format row stays locked while it is false
  // so this effect's condition should never even see format === "roadmap",
  // but a stray state change must not turn into a query anyway.
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
    const id = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - playStartRef.current) / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [mode]);

  // Debounced autosave of in-progress answers, mirroring the practice
  // screen's own draft autosave, so a half-played set resumes in place if the
  // host leaves and comes back.
  useEffect(() => {
    if (mode !== "play" || !playState) return;
    const id = window.setTimeout(() => {
      void db
        .from("study_sessions")
        .update({ feedback: { ...feedbackBaseRef.current, draftAnswers: playState.answers } })
        .eq("id", playState.session.id);
    }, 800);
    return () => window.clearTimeout(id);
  }, [playState?.answers, mode, playState?.session.id]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  // The resolved question count this match will actually be built with — a
  // preset already inside the server cap, or whatever survives clamping the
  // custom field. A blank, zero, negative or absurd ("5000") custom entry all
  // resolve inside range rather than reaching session creation.
  const resolvedCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const parsed = parseInt(customCount, 10);
    return clampInt(parsed, BATTLE_MIN_QUESTIONS, BATTLE_MAX_QUESTIONS);
  }, [countPreset, customCount]);

  const resolvedMinutes = useMemo(() => {
    const parsed = parseInt(minutes, 10);
    return clampInt(parsed, BATTLE_MIN_MINUTES, BATTLE_MAX_MINUTES);
  }, [minutes]);

  const explainRoadmapLocked = () => {
    toast.message("Roadmap battles are coming soon", {
      description:
        "A multi-stage battle with a win for each roadmap topic needs a database change that hasn't shipped yet. For now every Battle Royale match is a single, whole-file round.",
    });
  };

  const roadmapDocIds = selectedPlan?.source_document_ids?.length ? selectedPlan.source_document_ids : [];

  const canSend =
    enabled &&
    Boolean(opponent) &&
    !sending &&
    (format === "single"
      ? Boolean(selectedDoc) && (scope === "whole" || topicFocus.trim().length > 0)
      : BATTLE_SCHEMA_APPLIED && Boolean(selectedPlan) && planTopics.length > 0 && roadmapDocIds.length > 0);

  // ── Entering play / result ─────────────────────────────────────────────────

  const enterPlay = useCallback(
    (args: {
      session: SessionRow;
      questions: QuestionRow[];
      challengeId: string;
      timeLimitMinutes: number;
      roadmap?: PlayRoadmapCtx;
    }) => {
      const fb = (args.session.feedback ?? {}) as {
        draftAnswers?: Record<string, string>;
        time_limit_minutes?: number;
      } & Record<string, unknown>;
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
    if (
      window.confirm(
        "Leave this battle? It has already been sent and your answers so far are saved — you can come back and finish from Friends later.",
      )
    ) {
      backToSetup();
    }
  };

  // ── Sending ─────────────────────────────────────────────────────────────────

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
      setStageError(null);
      try {
        const result = await createSingleBattle({
          userId: user.id,
          profile,
          doc: selectedDoc,
          scope,
          topicFocus,
          count: resolvedCount,
          timeLimitMinutes: resolvedMinutes,
          opponentUsername: opponent.username,
          onProgress: setProgress,
        });
        toast.success(`Battle sent to @${opponent.username}.`);
        enterPlay({
          session: result.session,
          questions: result.questions,
          challengeId: result.challengeId,
          timeLimitMinutes: resolvedMinutes,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not send that battle";
        setStageError(message);
        toast.error(message);
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
    setStageError(null);
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
        onProgress: setProgress,
      });

      if (!result.rounds.length) {
        // The series row exists (it is cheap and has no AI spend) but nothing
        // could be built — tell the host plainly rather than pretending
        // something sent.
        const message = result.failedAt
          ? `Could not build round 1: ${result.failedAt.error}`
          : "Could not build any rounds for that roadmap.";
        setStageError(message);
        toast.error(message);
        return;
      }

      const [first, ...rest] = result.rounds;
      if (result.failedAt) {
        // A partly built series is explicitly allowed by the migration — say
        // so plainly rather than rolling anything back.
        toast.warning(`Sent ${result.rounds.length} of ${result.totalRounds} rounds`, {
          description:
            `Round ${result.failedAt.round} ("${result.failedAt.topicTitle}") could not be built — ` +
            `${result.failedAt.error} The ${result.rounds.length} round${result.rounds.length === 1 ? "" : "s"} ` +
            `that did send stand as a roadmap battle with @${opponent.username}.`,
        });
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
      const message = err instanceof Error ? err.message : "Could not send that roadmap battle";
      setStageError(message);
      toast.error(message);
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  // ── Playing ─────────────────────────────────────────────────────────────────

  const pickAnswer = (question: QuestionRow, optionId: string) => {
    setPlayState((cur) =>
      cur ? { ...cur, answers: { ...cur.answers, [question.id]: optionId } } : cur,
    );
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
        mode: (profile.preferred_mode as "Simplified" | "Detailed" | "Storytelling") || "Simplified",
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
      // session back. This is the exact ordering bug that once made
      // challenges unfinishable: called before the update, the server would
      // see an in-progress session and a student's score would never reach
      // the other side. See submitChallengeForSession's own comment in
      // src/lib/social.ts.
      await submitChallengeForSession(playState.session.id);

      toast.success("Battle submitted.");
      await enterResult(playState.challengeId, playState.questions.length, playState.roadmap);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit your answers");
      setPlayState((cur) => (cur ? { ...cur, submitting: false } : cur));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const shell = (children: React.ReactNode) => (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">{children}</div>
    </div>
  );

  if (!enabled) {
    return shell(
      <>
        <PageHeader eyebrow="Battle Royale" title="Study against someone, head to head" />
        <Panel>
          <p className="text-sm text-muted-foreground">
            Async friend matches aren&apos;t switched on for everyone yet. They&apos;ll appear here
            once they are.
          </p>
        </Panel>
      </>,
    );
  }

  return shell(
    <>
      {mode === "setup" && cameWithOpponent && (
        sending ? (
          <span className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground opacity-60">
            <ArrowLeft className="h-4 w-4" />
            Back to Friends
          </span>
        ) : (
          <Link
            to="/app/friends"
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-pop transition-colors hover:text-pop/80"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Friends
          </Link>
        )
      )}

      {mode === "play" && playState ? (
        <PlayView
          opponentUsername={opponent?.username ?? ""}
          playState={playState}
          elapsed={elapsed}
          onPick={pickAnswer}
          onSubmit={() => void submitBattle()}
          onLeave={confirmLeavePlay}
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
          <PageHeader eyebrow="Battle Royale" title="Who are you battling?" />
          <Panel>
            <SectionTitle icon={<Users className="h-4 w-4" />} title="Pick a friend" />
            {friendsLoading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Loading your friends…
              </p>
            ) : challengeableFriends.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No friends ready to battle yet. Add one from the{" "}
                <Link to="/app/friends" className="text-pop hover:text-pop/80">
                  Friends
                </Link>{" "}
                page.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {challengeableFriends.map((friend) => (
                  <button
                    key={friend.user_id}
                    type="button"
                    onClick={() =>
                      setOpponent({
                        userId: friend.user_id,
                        username: friend.username as string,
                        name: friend.display_name,
                      })
                    }
                    className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5 text-left transition-colors hover:border-pop/40 hover:bg-pop/5"
                  >
                    <Users className="h-4 w-4 shrink-0 text-pop" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                        {friend.display_name}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        @{friend.username}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </>
      ) : (
        <>
          <PageHeader
            eyebrow="Setting up a match"
            title={`Battle @${opponent.username}`}
            subtitle="Exam mode only — nothing is revealed until you both finish. Configure it, then send."
          />

          {/* Format */}
          <Panel>
            <SectionTitle icon={<Swords className="h-4 w-4" />} title="Format" />
            <div className="mt-3 space-y-2">
              <button
                type="button"
                onClick={() => setFormat("single")}
                disabled={sending}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  format === "single"
                    ? "border-pop/40 bg-pop/10"
                    : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-[-0.01em]">
                    Whole-file overview
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    One round. Finish it, see the result.
                  </span>
                </span>
                {format === "single" && <Check className="h-4 w-4 shrink-0 text-pop" />}
              </button>
              <button
                type="button"
                onClick={BATTLE_SCHEMA_APPLIED ? () => setFormat("roadmap") : explainRoadmapLocked}
                disabled={sending}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed ${
                  BATTLE_SCHEMA_APPLIED
                    ? format === "roadmap"
                      ? "border-pop/40 bg-pop/10 disabled:opacity-60"
                      : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02] disabled:opacity-60"
                    : "border-border bg-background/40 opacity-60"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold tracking-[-0.01em]">Roadmap</span>
                  <span className="block text-xs text-muted-foreground">
                    A win for each roadmap topic.
                  </span>
                </span>
                {BATTLE_SCHEMA_APPLIED ? (
                  format === "roadmap" && <Check className="h-4 w-4 shrink-0 text-pop" />
                ) : (
                  <>
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Soon
                    </span>
                    <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </>
                )}
              </button>
            </div>
          </Panel>

          {format === "single" ? (
            <>
              {/* File */}
              <Panel>
                <SectionTitle icon={<FileText className="h-4 w-4" />} title="Which file" />
                {docsLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Loading your files…</p>
                ) : docs.length === 0 ? (
                  <Link
                    to="/app/library"
                    className="mt-3 block rounded-xl border border-dashed border-border p-4 text-sm text-pop"
                  >
                    Upload a file in Library first.
                  </Link>
                ) : (
                  <div className="mt-3 max-h-60 space-y-2 overflow-y-auto pr-1">
                    {docs.map((doc) => {
                      const selected = selectedDocId === doc.id;
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setSelectedDocId(doc.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                            selected
                              ? "border-pop/40 bg-pop/10"
                              : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                          }`}
                        >
                          <FileText
                            className={`h-4 w-4 shrink-0 ${selected ? "text-pop" : "text-muted-foreground"}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                              {doc.file_name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {folderName(doc) || "Uncategorised"}
                            </span>
                          </span>
                          {selected && <Check className="h-4 w-4 shrink-0 text-pop" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* Scope */}
              {selectedDoc && (
                <Panel>
                  <SectionTitle icon={<FileText className="h-4 w-4" />} title="Scope" />
                  <div className="mt-3 flex gap-2">
                    <ScopePill
                      label="The whole file"
                      active={scope === "whole"}
                      onClick={() => setScope("whole")}
                    />
                    <ScopePill
                      label="A specific topic"
                      active={scope === "topic"}
                      onClick={() => setScope("topic")}
                    />
                  </div>
                  {scope === "topic" && (
                    <div className="mt-3 space-y-2">
                      <Input
                        value={topicFocus}
                        onChange={(event) => setTopicFocus(event.target.value)}
                        placeholder="e.g. Cranial nerves, Consideration in contract law…"
                      />
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        We&apos;ll pull only the pages about this topic, so every question stays
                        grounded on them.
                      </p>
                    </div>
                  )}
                </Panel>
              )}
            </>
          ) : (
            /* Roadmap picker */
            <Panel>
              <SectionTitle icon={<MapIcon className="h-4 w-4" />} title="Which roadmap" />
              {plansLoading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">Loading your roadmaps…</p>
              ) : plans.length === 0 ? (
                <Link
                  to="/app/studybody"
                  className="mt-3 block rounded-xl border border-dashed border-border p-4 text-sm text-pop"
                >
                  Build a roadmap in My Coach first.
                </Link>
              ) : (
                <div className="mt-3 space-y-2">
                  {plans.map((plan) => {
                    const selected = selectedPlanId === plan.id;
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setSelectedPlanId(plan.id)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          selected
                            ? "border-pop/40 bg-pop/10"
                            : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                        }`}
                      >
                        <MapIcon className={`h-4 w-4 shrink-0 ${selected ? "text-pop" : "text-muted-foreground"}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold tracking-[-0.01em]">
                            {plan.title}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {plan.source_type}
                          </span>
                        </span>
                        {selected && <Check className="h-4 w-4 shrink-0 text-pop" />}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedPlan && (
                <div className="mt-3">
                  {planTopicsLoading ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">Loading topics…</p>
                  ) : planTopics.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
                      This roadmap has no topics yet.
                    </p>
                  ) : (
                    <>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {planTopics.length} round{planTopics.length === 1 ? "" : "s"} — one battle per
                        topic, a win for each. @{opponent.username} sees them arrive one at a time as
                        they&apos;re built.
                      </p>
                      <ol className="mt-2 space-y-1">
                        {planTopics.map((t, i) => (
                          <li key={t.id} className="truncate text-xs text-muted-foreground">
                            {i + 1}. {t.title}
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {!roadmapDocIds.length && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                      <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                      This roadmap has no source files, so it can&apos;t be battled with yet.
                    </p>
                  )}
                </div>
              )}
            </Panel>
          )}

          {/* Question count */}
          <Panel>
            <SectionTitle icon={<Swords className="h-4 w-4" />} title="Questions" />
            <div className="mt-3 flex flex-wrap gap-2">
              {COUNT_PRESETS.map((n) => {
                const overCap = n > BATTLE_MAX_QUESTIONS;
                return (
                  <button
                    key={n}
                    type="button"
                    disabled={overCap}
                    onClick={() => setCountPreset(n)}
                    className={`min-w-16 flex-1 rounded-xl border px-3 py-2 text-sm font-medium tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      countPreset === n
                        ? "border-pop/50 bg-pop/10 text-pop"
                        : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setCountPreset("custom")}
                className={`min-w-16 flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
                  countPreset === "custom"
                    ? "border-pop/50 bg-pop/10 text-pop"
                    : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
                }`}
              >
                Custom
              </button>
            </div>
            {countPreset === "custom" && (
              <Input
                value={customCount}
                onChange={(event) => setCustomCount(event.target.value)}
                inputMode="numeric"
                placeholder={`${BATTLE_MIN_QUESTIONS}-${BATTLE_MAX_QUESTIONS}`}
                className="mt-3"
              />
            )}
            {/* Two different truths, and the copy must not tell the wrong one:
                with the migration unapplied the cap really is 12 and the bigger
                presets really are unreachable; once it lands they simply work,
                and an apology for a limit that no longer exists reads as a bug. */}
            <p className="mt-3 flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              {BATTLE_SCHEMA_APPLIED
                ? `Battles run up to ${BATTLE_MAX_QUESTIONS} questions — the largest set worth attempting against how long the AI takes to write one. This match will use ${resolvedCount}${format === "roadmap" ? " per round" : ""}.`
                : `Battles are capped at ${BATTLE_MAX_QUESTIONS} questions for now — that is the server's own limit for a fair, gradeable contest. 20 and 30 will unlock once that cap is raised. This match will use ${resolvedCount}.`}
            </p>
          </Panel>

          {/* Time to finish */}
          <Panel>
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="Time to finish" />
            <Input
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
              inputMode="numeric"
              placeholder="Minutes"
              className="mt-3 max-w-40"
            />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {BATTLE_MIN_MINUTES}-{BATTLE_MAX_MINUTES} minutes. This match will give{" "}
              {resolvedMinutes} min{format === "roadmap" ? " per round" : ""} — shown to your
              opponent, not force-submitted.
            </p>
          </Panel>

          <div className="space-y-2">
            <Button onClick={() => void send()} disabled={!canSend} className="w-full">
              <Send className="h-4 w-4" />
              {sending
                ? "Sending…"
                : format === "roadmap"
                  ? `Send roadmap battle to @${opponent.username}`
                  : `Send battle to @${opponent.username}`}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setOpponent(null)}
              disabled={sending}
              className="w-full"
            >
              Choose someone else
            </Button>
            {(sending || stageError) && (
              <StageProgress
                stages={progressStages(progress)}
                currentIndex={progress ? STAGE_ORDER.indexOf(progress.stage) : 0}
                error={sending ? null : stageError}
              />
            )}
          </div>
        </>
      )}
    </>,
  );
}

// ─── Play view ────────────────────────────────────────────────────────────────
//
// Trimmed to what Battle Royale actually needs: MCQ only, exam mode only, so
// there is no per-question feedback path and no essay field — showing the
// answer as it's picked, or grading a free-text answer instantly, would
// defeat the whole point of a contest that stays hidden until both sides
// finish. Cards/rows match the setup panels' own idiom above.
function PlayView({
  opponentUsername,
  playState,
  elapsed,
  onPick,
  onSubmit,
  onLeave,
}: {
  opponentUsername: string;
  playState: PlayState;
  elapsed: number;
  onPick: (question: QuestionRow, optionId: string) => void;
  onSubmit: () => void;
  onLeave: () => void;
}) {
  const { questions, answers, submitting, roadmap, durationSeconds } = playState;
  return (
    <>
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={onLeave}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Leave
        </button>
        {durationSeconds > 0 && (
          <div className="shrink-0 rounded-full border border-border px-3 py-1.5 font-mono text-sm text-pop">
            {elapsed >= durationSeconds ? "Time up" : formatClock(durationSeconds - elapsed)}
          </div>
        )}
      </div>

      <div>
        <span className="gd-eyebrow inline-flex items-center text-[11px] font-semibold uppercase tracking-[0.16em] text-pop">
          Exam mode{roadmap ? ` · Round ${roadmap.currentRound} of ${roadmap.totalRounds}` : ""}
        </span>
        <h1 className="mt-2 truncate text-balance font-display text-3xl font-light tracking-[-0.02em] text-foreground sm:text-4xl">
          Battle vs @{opponentUsername}
        </h1>
      </div>

      <div className="flex flex-col gap-3.5">
        {questions.map((question, index) => (
          <div key={question.id} className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <p className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              MCQ · {index + 1}/{questions.length}
            </p>
            <p className="mt-2 text-sm font-medium leading-relaxed">{question.prompt}</p>
            <div className="mt-3 flex flex-col gap-2">
              {(question.options ?? []).map((option) => {
                const picked = answers[question.id] === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onPick(question, option.id)}
                    className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors ${
                      picked
                        ? "border-pop/40 bg-pop/10"
                        : "border-border bg-background/40 hover:border-pop/30 hover:bg-foreground/[0.02]"
                    }`}
                  >
                    <span className="shrink-0 font-semibold uppercase">{option.id}</span>
                    <span className="min-w-0 flex-1 break-words">{option.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        <Button onClick={onSubmit} disabled={submitting} className="w-full">
          <Send className="h-4 w-4" />
          {submitting ? "Submitting…" : "Submit & finish"}
        </Button>
      </div>
    </>
  );
}

// ─── Result view ──────────────────────────────────────────────────────────────
//
// Reads challenge_list_mine() through lib/social.ts's listChallenges() rather
// than recomputing anything client-side. The release rule lives in that RPC
// (see its own comment in the migration): their_score/their_finished only
// appear once the caller has finished their own sitting, so "they haven't
// finished" is a real, expected state here, not a loading glitch — rendered
// as a sentence, never a 0 or a dash that would read as them having scored
// nothing.
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

  const outcomeTone =
    outcome === "won"
      ? "border-leaf/40 bg-leaf/10 text-leaf"
      : outcome === "lost"
        ? "border-border bg-foreground/[0.04] text-muted-foreground"
        : "border-pop/40 bg-pop/10 text-pop";

  return (
    <>
      <PageHeader
        eyebrow="Result"
        title={roadmap ? `Round ${roadmap.currentRound} of ${roadmap.totalRounds}` : "Your battle"}
      />

      <Panel>
        {resultState.loading && !s ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Checking the result…</p>
        ) : (
          <>
            <div className="flex items-center justify-center gap-6">
              <div className="text-center">
                <div className="text-3xl font-semibold tracking-[-0.01em]">{s?.my_score ?? 0}</div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  You
                </div>
              </div>
              <div className="text-sm text-muted-foreground">of {s?.question_count ?? resultState.questionCount}</div>
              <div className="text-center">
                <div
                  className={`text-3xl font-semibold tracking-[-0.01em] ${!theyFinished ? "text-muted-foreground" : ""}`}
                >
                  {theyFinished ? s?.their_score ?? 0 : "—"}
                </div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                  @{opponent.username}
                </div>
              </div>
            </div>

            {!theyFinished ? (
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Waiting for @{opponent.username} to play their set — their score only shows once they
                finish.
              </p>
            ) : (
              outcome && (
                <div className="mt-4 flex justify-center">
                  <span
                    className={`rounded-full border px-3 py-1 text-xs font-semibold capitalize ${outcomeTone}`}
                  >
                    {outcome === "won" ? "You won" : outcome === "lost" ? "You lost" : "Draw"}
                  </span>
                </div>
              )
            )}

            <div className="mt-4 flex justify-center">
              <Button variant="secondary" size="sm" onClick={onRefresh} disabled={resultState.loading}>
                <RefreshCw className={`h-3.5 w-3.5 ${resultState.loading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
            </div>
          </>
        )}
      </Panel>

      {roadmap && (
        <Panel>
          <SectionTitle icon={<MapIcon className="h-4 w-4" />} title="Roadmap series" />
          <p className="mt-2 text-xs text-muted-foreground">
            {roadmap.completedRounds} of {roadmap.totalRounds} round{roadmap.totalRounds === 1 ? "" : "s"}{" "}
            sent to @{opponent.username}.
          </p>
          {nextRound ? (
            <Button
              onClick={() =>
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
              className="mt-3 w-full"
            >
              <Play className="h-4 w-4" />
              Play round {nextRound.round}: {nextRound.topicTitle}
            </Button>
          ) : (
            roadmap.completedRounds > 1 && (
              <p className="mt-3 text-xs text-muted-foreground">
                That was the last round you&apos;ve played here — the rest (if any are still unplayed)
                are in Friends.
              </p>
            )
          )}
        </Panel>
      )}

      <Button variant="secondary" onClick={onDone} className="w-full">
        <ArrowLeft className="h-4 w-4" />
        Done
      </Button>
    </>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">{children}</section>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
      <span className="text-pop">{icon}</span>
      {title}
    </h2>
  );
}

function ScopePill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-xl border px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-pop/50 bg-pop/10 text-pop"
          : "border-border text-muted-foreground hover:border-pop/30 hover:bg-foreground/[0.02]"
      }`}
    >
      {label}
    </button>
  );
}
