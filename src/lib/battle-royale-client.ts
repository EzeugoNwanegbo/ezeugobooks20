// Battle Royale session builder for the website.
//
// Mirrors gandd-mobile/lib/battle-royale-client.ts: the host configures a
// fresh match (file or roadmap, scope, question count, time limit), this
// module turns that into the shape My Coach already writes
// (study_plans -> study_topics -> study_sessions -> study_questions) via
// createStraightInSession (src/lib/studybody-data.ts — the website HAS this
// helper, mobile did not, which is why mobile wrote its own buildQuestionSet
// from scratch and this file instead composes the existing one), and hands
// the finished session to challenge_create — directly for a single-file
// battle, or once per round for a roadmap series.
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS — challenge_create() rejects the whole set
// if even one question isn't MCQ, and a match that reveals answers as they're
// picked isn't a contest. See -app.battle-royale-page.tsx's header comment.
import {
  createStraightInSession,
  db,
  type DocRow,
  type PlanRow,
  type QuestionRow,
  type SessionRow,
  type StraightInStage,
  type TopicRow,
} from "@/lib/studybody-data";
import type { Profile } from "@/lib/auth-context";
import { BATTLE_SCHEMA_APPLIED, createChallenge, normalizeHandle } from "@/lib/social";

export type BattleScope = "whole" | "topic";

// ── Roadmap picking ──────────────────────────────────────────────────────────
//
// Same tables and shape as My Coach's own plan/topic reads (see
// -app.practice-page.tsx's ConfigView) — a roadmap battle sends one round per
// EXISTING roadmap topic, it never builds a new roadmap. Not gated on
// BATTLE_SCHEMA_APPLIED: study_plans/study_topics predate this migration
// entirely. What IS gated is turning them into a series — see
// createRoadmapBattleSeries below.

export async function loadBattlePlans(userId: string): Promise<PlanRow[]> {
  const { data, error } = await db
    .from("study_plans")
    .select("id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as PlanRow[]) ?? [];
}

export async function loadPlanTopics(userId: string, planId: string): Promise<TopicRow[]> {
  const { data, error } = await db
    .from("study_topics")
    .select("id, plan_id, title, summary, objectives, source_refs, position, status, mastery_score, last_practiced_at")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as TopicRow[]) ?? [];
}

export function buildBattleTitle(doc: DocRow, scope: BattleScope, focus: string, minutes: number): string {
  const base = scope === "topic" && focus ? `${doc.file_name} — ${focus}` : doc.file_name;
  // challenge_create() truncates whatever it reads from here to 80 chars, so a
  // long file name + focus is never a hard failure — just a title that loses
  // its tail, an acceptable trade for not rejecting a real file name.
  return `${base} · ${minutes} min`;
}

// ── Progress reporting ───────────────────────────────────────────────────────
//
// Real stages, not a guessed fraction. createStraightInSession already reports
// "reading"/"writing"/"saving" as each awaited step actually begins (see its
// own onStage param) — this just relabels those into Battle Royale's four
// named stages and adds the one createStraightInSession doesn't know about:
// sending the finished set to the opponent via challenge_create.
//
// STAGE "generating" CANNOT SHOW REAL SUB-PROGRESS. generateStudyQuestions is
// one opaque fetch to the studybody edge function — even though that function
// loops in batches of 20 server-side for a large count, nothing streams back
// mid-request, so there is nothing to interpolate. The page holds honestly on
// "Generating questions…" for the whole call rather than faking a tick that
// would finish before the AI does.
export type BattleStage = "retrieving" | "generating" | "saving" | "sending";

// The studybody function accepts up to 100,000 characters (~25,000 tokens). A
// WHOLE-FILE battle fills that, and the model then spends its whole output
// budget reading before writing a single question — it returns an empty
// completion and the send fails. Proved in testing: ten questions scoped to one
// TOPIC generated fine while the same ten over the whole file did not.
//
// 12,000 is deliberately well under, not merely under. A ten-to-thirty question
// contest does not need the textbook in the prompt, and a smaller prompt is also
// a faster one — generation time was the other complaint.
const BATTLE_DOC_CHARS_TOTAL = 12_000;

const STRAIGHT_STAGE_MAP: Record<StraightInStage, BattleStage> = {
  reading: "retrieving",
  writing: "generating",
  saving: "saving",
};

/** One real step beginning. `round` is present only while building a series. */
export type BattleProgressEvent = {
  stage: BattleStage;
  round?: { index: number; total: number };
};
export type OnBattleProgress = (event: BattleProgressEvent) => void;

// ── Reading back what was built ──────────────────────────────────────────────
//
// createStraightInSession only returns the ids it inserted (planId,
// sessionId) — the play view needs the full rows (feedback, options,
// correct_answer, …) so this re-reads them, once, right after. Also used
// after createChallenge/challenge_create: that RPC UPDATEs the session's
// feedback (mode -> 'exam', + challenge_id, + the time limit once the schema
// is applied), so the copy from the insert is stale the instant it returns.
async function fetchSessionAndQuestions(
  sessionId: string,
): Promise<{ session: SessionRow; questions: QuestionRow[] }> {
  const { data: sessionData, error: sessionErr } = await db
    .from("study_sessions")
    .select("id, plan_id, topic_id, question_type, score, requested_count, total_questions, status, feedback")
    .eq("id", sessionId)
    .single();
  if (sessionErr) throw new Error(sessionErr.message);

  const { data: questionData, error: questionErr } = await db
    .from("study_questions")
    .select(
      "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
    )
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  if (questionErr) throw new Error(questionErr.message);

  return { session: sessionData as SessionRow, questions: (questionData as QuestionRow[]) ?? [] };
}

// ── Single-file battle ───────────────────────────────────────────────────────

export async function createSingleBattle({
  userId,
  profile,
  doc,
  scope,
  topicFocus,
  count,
  timeLimitMinutes,
  opponentUsername,
  onProgress,
}: {
  userId: string;
  profile: Profile;
  doc: DocRow;
  scope: BattleScope;
  topicFocus: string;
  count: number;
  timeLimitMinutes: number;
  opponentUsername: string;
  onProgress?: OnBattleProgress;
}): Promise<{ session: SessionRow; questions: QuestionRow[]; challengeId: string; sessionId: string }> {
  const focus = topicFocus.trim();
  const topicScoped = scope === "topic" && Boolean(focus);
  const title = buildBattleTitle(doc, scope, focus, timeLimitMinutes);

  const { sessionId } = await createStraightInSession({
    userId,
    profile,
    title,
    documentIds: [doc.id],
    docsMeta: [doc],
    count,
    questionType: "mcq",
    difficulty: "medium",
    docCharBudget: BATTLE_DOC_CHARS_TOTAL,
    topicFocus: topicScoped ? focus : undefined,
    onStage: (stage) => onProgress?.({ stage: STRAIGHT_STAGE_MAP[stage] }),
  });

  onProgress?.({ stage: "sending" });
  // The limit only becomes a real constraint once the migration is applied —
  // before that there is no challenges.time_limit_minutes for it to live in.
  // Until then it travels in the title only (see buildBattleTitle).
  const challengeId = await createChallenge(
    opponentUsername,
    sessionId,
    BATTLE_SCHEMA_APPLIED ? timeLimitMinutes : undefined,
  );

  const { session, questions } = await fetchSessionAndQuestions(sessionId);
  return { session, questions, challengeId, sessionId };
}

// ── Roadmap series ───────────────────────────────────────────────────────────
//
// A roadmap battle is N ordinary challenges, one per roadmap topic, tied
// together by a challenge_series parent row (see section 3 of
// supabase/migrations/20260813120000_battle_royale.sql). The series row is
// created first (cheap, no AI spend), then rounds are built and sent ONE AT A
// TIME so a failure partway through leaves the rounds that already sent
// standing rather than rolling back a battle that already cost real AI spend
// and already reached the opponent for however many rounds landed.

export type RoadmapRoundResult = {
  round: number; // 1-based, matches challenges.round_index
  topicTitle: string;
  sessionId: string;
  session: SessionRow;
  questions: QuestionRow[];
  challengeId: string;
};

export type RoadmapBattleResult = {
  seriesId: string;
  totalRounds: number;
  /** Only the rounds that actually sent, in order. May be fewer than totalRounds. */
  rounds: RoadmapRoundResult[];
  /** Set when the loop stopped early. `rounds` still holds everything before it. */
  failedAt: { round: number; topicTitle: string; error: string } | null;
};

export async function createRoadmapBattleSeries({
  userId,
  profile,
  opponentUsername,
  plan,
  topics,
  docIds,
  docsMeta,
  count,
  timeLimitMinutes,
  onProgress,
}: {
  userId: string;
  profile: Profile;
  opponentUsername: string;
  plan: PlanRow;
  /** The roadmap's topics, in position order — one round per topic. */
  topics: TopicRow[];
  docIds: string[];
  docsMeta: DocRow[];
  count: number;
  timeLimitMinutes: number;
  onProgress?: OnBattleProgress;
}): Promise<RoadmapBattleResult> {
  // Belt and braces on top of the setup screen keeping the format row locked:
  // this function must be UNREACHABLE, not just unreached, while the
  // migration is unapplied. Everything below names challenge_series /
  // series_id / round_index — schema that does not exist until
  // BATTLE_SCHEMA_APPLIED is flipped — so it must never run while it is
  // false. This is the FIRST statement in the function for exactly that
  // reason: no query below it can execute before this throw does.
  if (!BATTLE_SCHEMA_APPLIED) {
    throw new Error("Roadmap battles need a database update that hasn't shipped yet.");
  }
  if (!topics.length) {
    throw new Error("This roadmap has no topics yet.");
  }

  // 1. The parent row only. challenge_series_create raises its own friendly
  // message ("You already have a roadmap battle running with this friend.")
  // when the one-active-series-per-friend limit is hit — let it propagate
  // rather than swallowing it, so the host sees exactly why nothing sent.
  const { data: seriesData, error: seriesErr } = await db.rpc("challenge_series_create", {
    p_opponent_username: normalizeHandle(opponentUsername),
    p_title: plan.title,
    p_plan_id: plan.id,
  });
  if (seriesErr) throw new Error(seriesErr.message);
  const seriesId = seriesData as string;

  const total = topics.length;
  const rounds: RoadmapRoundResult[] = [];
  let failedAt: RoadmapBattleResult["failedAt"] = null;

  for (let i = 0; i < total; i += 1) {
    const topic = topics[i];
    const roundNumber = i + 1;
    const title = `${plan.title} — ${topic.title}`;

    try {
      const { sessionId } = await createStraightInSession({
        userId,
        profile,
        title,
        documentIds: docIds,
        docsMeta,
        count,
        questionType: "mcq",
        difficulty: "medium",
        // A topic-pinpointed pull is already far smaller than a whole-file one,
        // so this rarely binds — but a series is N generations back to back, and
        // one round stalling on an oversized prompt strands the whole roadmap
        // half-sent. The cap costs nothing when it is not needed.
        docCharBudget: BATTLE_DOC_CHARS_TOTAL,
        // Pinpoints retrieval to this topic's own chunks — the grounded pull,
        // same as a single battle's "specific topic" scope — rather than
        // sampling the whole roadmap's material for every round.
        topicFocus: topic.title,
        onStage: (stage) =>
          onProgress?.({
            stage: STRAIGHT_STAGE_MAP[stage],
            round: { index: roundNumber, total },
          }),
      });

      onProgress?.({ stage: "sending", round: { index: roundNumber, total } });
      // Raw RPC, not lib/social.ts's createChallenge: that helper has no
      // series_id/round_index parameters (adding them there would mean naming
      // this migration's schema on the SAME call path a two-argument ordinary
      // challenge_create uses). This call only ever runs once
      // BATTLE_SCHEMA_APPLIED is true, guarded above, so the
      // five-argument/series shape of challenge_create is guaranteed to exist.
      const { data: challengeIdData, error: createErr } = await db.rpc("challenge_create", {
        p_opponent_username: normalizeHandle(opponentUsername),
        p_session_id: sessionId,
        p_time_limit_minutes: Math.round(timeLimitMinutes),
        p_series_id: seriesId,
        p_round_index: roundNumber,
      });
      if (createErr) throw new Error(createErr.message);

      const { session, questions } = await fetchSessionAndQuestions(sessionId);
      rounds.push({
        round: roundNumber,
        topicTitle: topic.title,
        sessionId,
        session,
        questions,
        challengeId: challengeIdData as string,
      });
    } catch (err) {
      // A partly built series is explicitly allowed — challenge_series_create's
      // own comment in the migration says so. Stop here rather than trying
      // every remaining topic: if this round failed there is a real reason (AI
      // outage, network), and hammering the same failure N more times just
      // burns AI spend on rounds that will not save either. What DID send
      // stands, and challenge_series_resolve() settles exactly those rounds
      // once they finish.
      failedAt = {
        round: roundNumber,
        topicTitle: topic.title,
        error: err instanceof Error ? err.message : "Could not build this round",
      };
      break;
    }
  }

  return { seriesId, totalRounds: total, rounds, failedAt };
}
