// G&D — Battle Royale session builder for the native app.
//
// Battle Royale replaces the old "pick one of your own sets" challenge flow in
// Friends: the host configures a fresh match right here — file, scope, question
// count, time limit — and this module turns that into the same shape My Coach
// already writes (study_plans -> study_topics -> study_sessions ->
// study_questions), exactly mirroring web's createStraightInSession
// (src/lib/studybody-data.ts) since mobile has no port of that "straight in"
// flow to import. friends.tsx then hands the finished session id to
// lib/social.ts's createChallenge(), which calls the existing challenge_create
// RPC. There is no new table and no new RPC here — challenge_create() already
// accepts "an existing, unplayed, MCQ-only session" (see the 2026-08-09
// migration), which is exactly what this builds.
//
// EXAM MODE, MCQ ONLY, ALWAYS. Two reasons converge on the same answer:
//   * the brief — Battle Royale reveals nothing mid-match, so Learning mode's
//     instant per-question feedback has no place here;
//   * the schema — challenge_create() raises on any set containing a non-MCQ
//     question (an essay has no stored key the server can grade a contest on).
// Generating anything else would either be pointless (challenge_create forces
// the session's feedback.mode to 'exam' the moment it is sent anyway) or would
// make the RPC refuse the set after the AI spend already happened. Asking for
// mcq only, every time, avoids both.
import { db, folderName, loadStudyDocuments, loadStudyDocumentsSpanning, type DocRow } from "./studybody-data";
import { generateStudyQuestions } from "./studybody-client";
import type { Profile } from "./auth";
import { MAX_CHALLENGE_QUESTIONS } from "./social";

export { folderName, type DocRow };

/**
 * Is 20260813120000_battle_royale.sql applied in production yet?
 *
 * FALSE until it has been run BY HAND. Same contract as SOCIAL_SCHEMA_APPLIED in
 * ./social.ts and DEDUP_SCHEMA_APPLIED in the website's src/lib/content-hash.ts:
 * naming schema that does not exist fails the whole statement, and shipping code
 * ahead of its migration has taken this product down before.
 *
 * That migration raises the challenge cap from 12 to 60, adds
 * challenges.time_limit_minutes and carries it onto the opponent's copy, and
 * adds challenge_series for roadmap battles. NOTHING here may reference any of
 * that while this is false — not the wider cap, not the third argument to
 * challenge_create(), not a series row. Everything below is written to work on
 * TODAY's schema with the flag off, and the one-off battle must keep doing so.
 *
 * Flip to true only after the migration is applied and verified.
 */
export const BATTLE_SCHEMA_APPLIED = false;

// Server hard cap. Two numbers, and which one is live depends on the flag above:
//   flag off — challenges.question_count CHECK (BETWEEN 1 AND 12) plus
//              challenge_create()'s own "up to 12 questions" guard;
//   flag on  — both widened to 60 by the migration, which is where the studybody
//              edge function clamps generation anyway, so 60 is the largest set
//              that can actually be built.
// MAX_CHALLENGE_QUESTIONS is mirrored from lib/social.ts (which mirrors the
// migration) rather than re-declared, so there is one number that means "what
// today's schema allows".
export const BATTLE_MAX_QUESTIONS_POOLED = 60;
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

function buildBattleTitle(doc: DocRow, scope: BattleScope, focus: string, minutes: number): string {
  const base = scope === "topic" && focus ? `${doc.file_name} — ${focus}` : doc.file_name;
  // challenge_create() truncates whatever it reads from here to 80 chars
  // (`left(..., 80)`), so a long file name + focus is never a hard failure —
  // just a title that loses its tail, which is an acceptable trade for not
  // rejecting a real file name.
  return `${base} · ${minutes} min`;
}

export async function createBattleSession({
  userId,
  profile,
  doc,
  scope,
  topicFocus,
  count,
  timeLimitMinutes,
}: {
  userId: string;
  profile: Profile;
  doc: DocRow;
  scope: BattleScope;
  topicFocus: string;
  count: number;
  timeLimitMinutes: number;
}): Promise<{ sessionId: string }> {
  const focus = topicFocus.trim();
  const topicScoped = scope === "topic" && Boolean(focus);

  // Same retrieval split My Coach's roadmap builder uses for scope: a
  // pinpointed pull of just the matching chunks for a topic (grounded, with
  // page refs), or an evenly-sampled span of the whole file when the host wants
  // everything in play.
  const documents = topicScoped
    ? await loadStudyDocuments([doc.id], focus)
    : await loadStudyDocumentsSpanning([doc.id], [doc]);

  const title = buildBattleTitle(doc, scope, focus, timeLimitMinutes);
  const topicStub = {
    title,
    summary: topicScoped
      ? `A Battle Royale match focused on "${focus}" from ${doc.file_name}.`
      : `A Battle Royale match drawn from across the whole of ${doc.file_name}.`,
    objectives: [],
    source_refs: [],
  };

  const generated = await generateStudyQuestions({
    profile,
    topic: topicStub,
    questionType: "mcq",
    count,
    documents,
    difficulty: "medium",
  });
  // Belt and braces: the edge function is asked for mcq only, but
  // challenge_create() rejects the WHOLE set if even one question is not mcq,
  // and that check runs only after this AI spend has already happened. Trim any
  // stray non-mcq item here rather than let a rare model slip cost the send.
  const mcqOnly = generated.questions.filter((q) => q.type !== "essay").slice(0, count);
  if (!mcqOnly.length) {
    throw new Error("No multiple-choice questions could be built from this file. Try another one.");
  }

  const { data: planData, error: planErr } = await db
    .from("study_plans")
    .insert({
      user_id: userId,
      title,
      course_outline: "",
      source_type: "uploaded",
      source_document_ids: [doc.id],
      preference_snapshot: { battle_royale: true },
    })
    .select("id")
    .single();
  if (planErr) throw planErr;
  const planId = (planData as { id: string }).id;

  const { data: topicData, error: topicErr } = await db
    .from("study_topics")
    .insert({
      user_id: userId,
      plan_id: planId,
      title,
      summary: topicStub.summary,
      objectives: [],
      source_refs: [],
      position: 0,
      status: "practicing",
    })
    .select("id")
    .single();
  if (topicErr) throw topicErr;
  const topicId = (topicData as { id: string }).id;

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
      feedback: { mode: "exam", battle_royale: true, time_limit_minutes: timeLimitMinutes },
    })
    .select("id")
    .single();
  if (sessionErr) throw sessionErr;
  const sessionId = (sessionData as { id: string }).id;

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
    difficulty: q.difficulty ?? "medium",
    source_refs: q.source_refs ?? [],
    position: index,
  }));
  const { error: questionErr } = await db.from("study_questions").insert(questionRows);
  if (questionErr) throw questionErr;

  return { sessionId };
}
