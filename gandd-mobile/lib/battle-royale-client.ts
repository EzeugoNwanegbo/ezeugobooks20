// G&D — Battle Royale session builder for the native app.
//
// Battle Royale replaces the old "pick one of your own sets" challenge flow in
// Friends: the host configures a fresh match right here — file (or roadmap),
// scope, question count, difficulty, time limit — and this module turns that
// into the same shape My Coach already writes (study_plans -> study_topics ->
// study_sessions -> study_questions), exactly mirroring web's
// createStraightInSession (src/lib/studybody-data.ts) since mobile has no port
// of that "straight in" flow to import. The screen then hands the finished
// session id to challenge_create (either directly here for the single-file
// path, or per-round for a roadmap series) so there is one place that knows
// how a battle gets sent.
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS — see below for why both are non-negotiable
// (brief + the challenge_create() RPC's own guard).
import {
  db,
  type DifficultyLevel,
  folderName,
  loadStudyDocuments,
  loadStudyDocumentsSpanning,
  type DocRow,
  type PlanRow,
  type QuestionRow,
  type SessionRow,
  type TopicRow,
} from "./studybody-data";
import { generateStudyQuestions } from "./studybody-client";
import type { Profile } from "./auth";
import { createChallenge, MAX_CHALLENGE_QUESTIONS, normalizeHandle } from "./social";

export { folderName, type DocRow };

/**
 * Is 20260813120000_battle_royale.sql applied in production yet?
 *
 * FALSE until it has been run BY HAND. Same contract as SOCIAL_SCHEMA_APPLIED in
 * ./social.ts and DEDUP_SCHEMA_APPLIED in the website's src/lib/content-hash.ts:
 * naming schema that does not exist fails the whole statement, and shipping code
 * ahead of its migration has taken this product down before.
 *
 * That migration raises the challenge cap from 12 to 100, adds
 * challenges.time_limit_minutes and carries it onto the opponent's copy, and
 * adds challenge_series for roadmap battles. NOTHING here may reference any of
 * that while this is false — not the wider cap, not the third argument to
 * challenge_create(), not a series row, not challenge_series_create. Everything
 * below is written to work on TODAY's schema with the flag off, and the
 * one-off battle must keep doing so. Roadmap battles are UNREACHABLE from the
 * screen while this is false (the format row stays locked) and
 * createRoadmapBattleSeries() below throws immediately as a second guard.
 *
 * THE MIGRATION IS NOT THE ONLY THING THAT HAS TO SHIP. 100 also requires the
 * studybody edge function to be redeployed: it clamped generation at 60, and
 * until `supabase functions deploy studybody` has run a request for 100 comes
 * back with 60 questions. Flip this flag only once BOTH have happened and been
 * verified.
 */
export const BATTLE_SCHEMA_APPLIED = true;

// Server hard cap. Two numbers, and which one is live depends on the flag above:
//   flag off — challenges.question_count CHECK (BETWEEN 1 AND 12) plus
//              challenge_create()'s own "up to 12 questions" guard;
//   flag on  — both widened to 100 by the migration, matched by the studybody
//              edge function's own clamp, which was raised in the same change.
// MAX_CHALLENGE_QUESTIONS is mirrored from lib/social.ts (which mirrors the
// migration) rather than re-declared, so there is one number that means "what
// today's schema allows".
export const BATTLE_MAX_QUESTIONS_POOLED = 100;
export const BATTLE_MAX_QUESTIONS = BATTLE_SCHEMA_APPLIED
  ? BATTLE_MAX_QUESTIONS_POOLED
  : MAX_CHALLENGE_QUESTIONS; // 12
// A 1- or 2-question "battle" is barely a contest, so 3 is the floor here.
// Deliberately NOT tied to My Coach's smallest preset: that is 10 now, and a
// battle is capped at 12 by the schema, so borrowing My Coach's floor would
// leave a range of 10-12 and make the Custom field almost pointless.
export const BATTLE_MIN_QUESTIONS = 3;

// There is no schema field that carries a time limit onto the OPPONENT's copy
// of the match: challenge_begin() (see the migration) builds their session's
// `feedback` from scratch — jsonb_build_object('mode', 'exam', 'challenge_id',
// c.id) — and does not carry over anything the challenger's session held. So a
// per-match timer cannot be *enforced* on the current schema, and adding a
// column for it is exactly the kind of ahead-of-migration change this build
// must not make. What the existing schema DOES carry to both players is
// challenges.title, snapshotted once at challenge_create time from the
// challenger's own topic title — so the chosen limit is folded into that title
// (see buildBattleTitle below) rather than silently dropped. It is a pace the
// opponent is told, not one anything stops them going over.
export const BATTLE_MIN_MINUTES = 1;
export const BATTLE_MAX_MINUTES = 180; // 3 hours — generous, but bounds a fat-fingered 5000

export type BattleScope = "whole" | "topic";

/** The host's own files, same shape and query My Coach's picker uses. */
export async function loadBattleDocuments(userId: string): Promise<DocRow[]> {
  const { data, error } = await db
    .from("documents")
    .select("id, file_name, extracted_text, folder_id, folders(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as DocRow[]) ?? [];
}

// ── Roadmap picking (for the roadmap format) ─────────────────────────────────
//
// Same tables and same shape as coach.tsx's own roadmap switcher
// (refreshDocsAndPlans / refreshTopics) — a roadmap battle sends one round per
// EXISTING roadmap topic, it does not build a new roadmap. Kept as plain reads
// here rather than gated on BATTLE_SCHEMA_APPLIED: study_plans/study_topics
// already exist for My Coach and are not part of this migration. What IS gated
// is turning them into a series — see createRoadmapBattleSeries below.

export async function loadBattlePlans(userId: string): Promise<PlanRow[]> {
  const { data, error } = await db
    .from("study_plans")
    .select("id, title, course_outline, source_type, source_document_ids, status, created_at, updated_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data as PlanRow[]) ?? [];
}

export async function loadPlanTopics(userId: string, planId: string): Promise<TopicRow[]> {
  const { data, error } = await db
    .from("study_topics")
    .select("id, plan_id, title, summary, objectives, source_refs, position, status, mastery_score, last_practiced_at")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (error) throw error;
  return (data as TopicRow[]) ?? [];
}

function buildBattleTitle(doc: DocRow, scope: BattleScope, focus: string, minutes: number): string {
  const base = scope === "topic" && focus ? `${doc.file_name} — ${focus}` : doc.file_name;
  // challenge_create() truncates whatever it reads from here to 80 chars
  // (`left(..., 80)`), so a long file name + focus is never a hard failure —
  // just a title that loses its tail, which is an acceptable trade for not
  // rejecting a real file name.
  return `${base} · ${minutes} min`;
}

// ── Progress reporting ───────────────────────────────────────────────────────
//
// The owner asked for a real staged bar instead of a spinner: sending is
// genuinely slow (a 100-question battle is ~6 sequential AI calls once the cap
// is raised) and a fake bar that finishes before the work does is worse than
// no bar at all. Every stage below is a real step createBattleSession /
// createRoadmapBattleSeries actually performs, in order.

export type BattleStage = "retrieving" | "generating" | "saving" | "sending";

export type BattleProgress = {
  stage: BattleStage;
  /** 0..1 — overall progress of the whole operation (one set, or a whole series). */
  fraction: number;
  /** Ready-to-render label, already carrying "Round N of M" for a series. */
  label: string;
};

export type OnBattleProgress = (progress: BattleProgress) => void;

const STAGE_LABEL: Record<BattleStage, string> = {
  retrieving: "Reading your material…",
  generating: "Generating questions…",
  saving: "Saving the set…",
  sending: "Sending to your opponent…",
};

// Relative weight of each stage within one set. Generation dominates because
// it is the one real AI call per set (and, once the cap is raised, the edge
// function's own batches-of-20 loop inside that single call) — retrieval and
// the four sequential inserts are comparatively instant.
const STAGE_BOUNDS: Record<BattleStage, [number, number]> = {
  retrieving: [0, 0.08],
  generating: [0.08, 0.78],
  saving: [0.78, 0.93],
  sending: [0.93, 1],
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

type StageReporter = (stage: BattleStage, within: number) => void;

// ── The shared build: retrieve → generate → save ─────────────────────────────
//
// One question set, start to finish, minus the "send" step (single-file and
// roadmap send differently — a plain challenge_create vs. one with series
// args — so that step lives in each caller). Used both by createBattleSession
// (one call) and by createRoadmapBattleSeries (once per round).
async function buildQuestionSet({
  userId,
  profile,
  docIds,
  docsMeta,
  focus,
  title,
  summary,
  count,
  difficulty,
  timeLimitMinutes,
  reportStage,
}: {
  userId: string;
  profile: Profile;
  docIds: string[];
  docsMeta: DocRow[];
  /** "" means whole-file/whole-roadmap-topic-set spanning; non-empty means a grounded topic pull. */
  focus: string;
  title: string;
  summary: string;
  count: number;
  difficulty: DifficultyLevel;
  timeLimitMinutes: number;
  reportStage: StageReporter;
}): Promise<{ planId: string; topicId: string; sessionId: string; questions: QuestionRow[] }> {
  reportStage("retrieving", 0);
  // Same retrieval split My Coach's roadmap builder uses for scope: a
  // pinpointed pull of just the matching chunks for a topic (grounded, with
  // page refs), or an evenly-sampled span of the whole file when there is no
  // focus to pin to.
  const documents = focus
    ? await loadStudyDocuments(docIds, focus)
    : await loadStudyDocumentsSpanning(docIds, docsMeta);
  reportStage("retrieving", 1);

  const topicStub = { title, summary, objectives: [], source_refs: [] };

  reportStage("generating", 0);
  // THIS STAGE CANNOT SHOW REAL MOTION. generateStudyQuestions is one opaque
  // fetch to the studybody edge function — even though that function loops in
  // batches of 20 server-side for a large count, nothing streams back from it
  // mid-request, so there is no sub-progress to read here. Rather than fake a
  // ticking bar (which would finish before the AI call does — worse than a
  // plain spinner, per the brief), this stage sits at its start boundary with
  // an honest "Generating questions…" label until the call resolves.
  const generated = await generateStudyQuestions({
    profile,
    topic: topicStub,
    questionType: "mcq",
    count,
    documents,
    difficulty,
  });
  reportStage("generating", 1);

  // Belt and braces: the edge function is asked for mcq only, but
  // challenge_create() rejects the WHOLE set if even one question is not mcq,
  // and that check runs only after this AI spend has already happened. Trim any
  // stray non-mcq item here rather than let a rare model slip cost the send.
  const mcqOnly = generated.questions.filter((q) => q.type !== "essay").slice(0, count);
  if (!mcqOnly.length) {
    throw new Error("No multiple-choice questions could be built from this material. Try another one.");
  }

  reportStage("saving", 0);
  const { data: planData, error: planErr } = await db
    .from("study_plans")
    .insert({
      user_id: userId,
      title,
      course_outline: "",
      source_type: "uploaded",
      source_document_ids: docIds,
      preference_snapshot: { battle_royale: true },
    })
    .select("id")
    .single();
  if (planErr) throw planErr;
  const planId = (planData as { id: string }).id;
  reportStage("saving", 0.25);

  const { data: topicData, error: topicErr } = await db
    .from("study_topics")
    .insert({
      user_id: userId,
      plan_id: planId,
      title,
      summary,
      objectives: [],
      source_refs: [],
      position: 0,
      status: "practicing",
    })
    .select("id")
    .single();
  if (topicErr) throw topicErr;
  const topicId = (topicData as { id: string }).id;
  reportStage("saving", 0.5);

  const { data: sessionData, error: sessionErr } = await db
    .from("study_sessions")
    .insert({
      user_id: userId,
      plan_id: planId,
      topic_id: topicId,
      question_type: "mcq",
      requested_count: count,
      total_questions: mcqOnly.length,
      // 'exam' here is what the brief asks for directly (no reveal until the
      // end), and it is also the value challenge_create() would force onto this
      // row's feedback the moment the match is sent — see the UPDATE at the
      // foot of that function in the migration. Setting it up front means the
      // host's own preview (if they reopen this session before sending) already
      // behaves like the match it is about to become.
      feedback: { mode: "exam", battle_royale: true, difficulty, time_limit_minutes: timeLimitMinutes },
    })
    .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
    .single();
  if (sessionErr) throw sessionErr;
  const sessionId = (sessionData as { id: string }).id;
  reportStage("saving", 0.75);

  const questionRows = mcqOnly.map((q, index) => ({
    user_id: userId,
    session_id: sessionId,
    plan_id: planId,
    topic_id: topicId,
    question_type: "mcq" as const,
    prompt: q.prompt,
    options: q.options ?? [],
    correct_answer: q.correct_answer,
    explanation: q.explanation ?? "",
    rubric: q.rubric ?? [],
    difficulty: q.difficulty ?? difficulty,
    source_refs: q.source_refs ?? [],
    position: index,
  }));
  const { data: savedQuestions, error: questionErr } = await db
    .from("study_questions")
    .insert(questionRows)
    .select(
      "id, session_id, question_type, prompt, options, correct_answer, explanation, rubric, source_refs, difficulty, position",
    )
    .order("position", { ascending: true });
  if (questionErr) throw questionErr;
  reportStage("saving", 1);

  return { planId, topicId, sessionId, questions: (savedQuestions as QuestionRow[]) ?? [] };
}

/** Re-reads a session after challenge_create — it stamps feedback.mode = 'exam'
 * (and, once BATTLE_SCHEMA_APPLIED, the time limit) via an UPDATE that runs
 * server-side, so the local copy from the insert above is stale the instant
 * the RPC returns. */
async function refetchSession(sessionId: string): Promise<SessionRow> {
  const { data, error } = await db
    .from("study_sessions")
    .select("id, plan_id, topic_id, question_type, score, total_questions, status, feedback")
    .eq("id", sessionId)
    .single();
  if (error) throw error;
  return data as SessionRow;
}

// ── Single-file battle ───────────────────────────────────────────────────────

export async function createBattleSession({
  userId,
  profile,
  doc,
  scope,
  topicFocus,
  count,
  timeLimitMinutes,
  difficulty = "medium",
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
  difficulty?: DifficultyLevel;
  opponentUsername: string;
  onProgress?: OnBattleProgress;
}): Promise<{
  sessionId: string;
  planId: string;
  topicId: string;
  session: SessionRow;
  questions: QuestionRow[];
  challengeId: string;
}> {
  const focus = topicFocus.trim();
  const topicScoped = scope === "topic" && Boolean(focus);

  const title = buildBattleTitle(doc, scope, focus, timeLimitMinutes);
  const summary = topicScoped
    ? `A Battle Royale match focused on "${focus}" from ${doc.file_name}.`
    : `A Battle Royale match drawn from across the whole of ${doc.file_name}.`;

  const reportStage: StageReporter = (stage, within) => {
    if (!onProgress) return;
    const [start, end] = STAGE_BOUNDS[stage];
    onProgress({ stage, fraction: start + (end - start) * clamp01(within), label: STAGE_LABEL[stage] });
  };

  const built = await buildQuestionSet({
    userId,
    profile,
    docIds: [doc.id],
    docsMeta: [doc],
    focus: topicScoped ? focus : "",
    title,
    summary,
    count,
    difficulty,
    timeLimitMinutes,
    reportStage,
  });

  reportStage("sending", 0);
  // The limit only becomes a real constraint once the migration is applied:
  // before that there is no challenges.time_limit_minutes for it to live in.
  // Until then it travels in the title only (see buildBattleTitle) — a pace
  // both players are told, not one anything enforces.
  const challengeId = await createChallenge(
    opponentUsername,
    built.sessionId,
    BATTLE_SCHEMA_APPLIED ? timeLimitMinutes : undefined,
  );
  reportStage("sending", 1);

  const session = await refetchSession(built.sessionId);
  return { ...built, session, challengeId };
}

// ── Roadmap series ───────────────────────────────────────────────────────────
//
// A roadmap battle is N ordinary challenges, one per roadmap topic, tied
// together by a challenge_series parent row — exactly the shape the migration
// describes in its section 3. The series row is created first (cheap, no AI
// spend), then rounds are built and sent ONE AT A TIME so a failure partway
// through leaves the rounds that already sent standing rather than rolling
// back a battle that already cost real AI spend and already reached the
// opponent for however many rounds landed.

export type RoadmapRoundResult = {
  round: number; // 1-based, matches challenges.round_index
  topicTitle: string;
  planId: string;
  topicId: string;
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
  /** Set when the loop stopped early. rounds still holds everything before it. */
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
  difficulty = "medium",
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
  difficulty?: DifficultyLevel;
  onProgress?: OnBattleProgress;
}): Promise<RoadmapBattleResult> {
  // Belt and braces on top of the screen keeping the format row locked: this
  // function must be unreachable, not just unreached, while the migration is
  // unapplied — see the flag's own comment for why. No RPC name below this
  // guard runs while it is false.
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
    const roundStart = i / total;
    const roundEnd = (i + 1) / total;

    // Maps a stage's progress WITHIN this one round onto this round's slice of
    // the whole series, so the bar advances smoothly across all N rounds
    // instead of resetting to 0% every round.
    const reportStage: StageReporter = (stage, within) => {
      if (!onProgress) return;
      const [s, e] = STAGE_BOUNDS[stage];
      const roundFraction = s + (e - s) * clamp01(within);
      onProgress({
        stage,
        fraction: roundStart + (roundEnd - roundStart) * roundFraction,
        label: `Round ${roundNumber} of ${total} — ${STAGE_LABEL[stage]}`,
      });
    };

    try {
      const built = await buildQuestionSet({
        userId,
        profile,
        docIds,
        docsMeta,
        focus: topic.title,
        title: `${plan.title} — ${topic.title}`,
        summary: `Round ${roundNumber} of a roadmap battle: "${topic.title}" from ${plan.title}.`,
        count,
        difficulty,
        timeLimitMinutes,
        reportStage,
      });

      reportStage("sending", 0);
      // Raw RPC, not lib/social.ts's createChallenge: that helper has no
      // series_id/round_index parameters (adding them there would mean
      // naming this migration's schema in a file this build does not own, and
      // would put the series args on the SAME call path a two-argument
      // ordinary challenge_create uses). This call only ever runs once
      // BATTLE_SCHEMA_APPLIED is true, so the three-argument-plus-series
      // shape of challenge_create is guaranteed to exist.
      const { data: challengeIdData, error: createErr } = await db.rpc("challenge_create", {
        p_opponent_username: normalizeHandle(opponentUsername),
        p_session_id: built.sessionId,
        p_time_limit_minutes: Math.round(timeLimitMinutes),
        p_series_id: seriesId,
        p_round_index: roundNumber,
      });
      if (createErr) throw new Error(createErr.message);
      reportStage("sending", 1);

      const session = await refetchSession(built.sessionId);
      rounds.push({
        round: roundNumber,
        topicTitle: topic.title,
        planId: built.planId,
        topicId: built.topicId,
        sessionId: built.sessionId,
        session,
        questions: built.questions,
        challengeId: challengeIdData as string,
      });
    } catch (err) {
      // A partly built series is explicitly allowed — the migration's own
      // comment on challenge_series_create says so. Stop here rather than
      // trying every remaining topic: if this round failed there is a real
      // reason (AI outage, network), and hammering the same failure N more
      // times just burns AI spend on rounds that will not save either. What
      // DID send stands, and challenge_series_resolve() (elsewhere) settles
      // exactly those rounds once they finish.
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
