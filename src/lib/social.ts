// Friends and asynchronous challenges: the one place the social schema is named.
//
// ── OFF UNTIL THE MIGRATION IS APPLIED ──────────────────────────────────────
// Everything below depends on schema that does not exist in production yet:
// user_profiles.username / username_set_at / discoverable_by, the friendships,
// challenges and challenge_participants tables, and the claim_username,
// find_student, friend_*, challenge_* RPCs - all created by
// supabase/migrations/20260809120000_social_usernames_friends_async_challenges.sql.
//
// That migration is applied by hand by the owner, so the app must not assume it
// has run. Naming a column, view or function that does not exist makes PostgREST
// reject the WHOLE statement - not the one field, the statement - which is how
// web uploads, mobile uploads and PQ retrieval went down together once
// already. Every reference to the new schema is therefore behind this flag.
//
// Flip it to true in the SAME commit that applies the migration. Not before,
// and not in a separate deploy.
//
// With it false, this module makes no network call of any kind: every read
// returns an empty result before it reaches Supabase, every write throws
// locally, and `socialEnabled()` is false so no entry point renders. There is
// nothing to fail because nothing is asked.
export const SOCIAL_SCHEMA_APPLIED = true;

/**
 * Is supabase/migrations/20260813120000_battle_royale.sql applied in
 * production yet?
 *
 * FALSE until it has been run BY HAND — same contract as SOCIAL_SCHEMA_APPLIED
 * above, and it can only ever be flipped once that one already is (the file
 * itself refuses to apply otherwise). That migration raises the challenge cap
 * from 12 to 100 (matched by a redeploy of the studybody edge function, which
 * clamped generation at 60 — both have to move together or the cap becomes a
 * lie), adds challenges.time_limit_minutes (carried onto the opponent's copy
 * by a rewritten challenge_begin()), and adds challenge_series for roadmap
 * battles: a table plus challenge_series_create() / challenge_series_resolve(),
 * and a series_id/round_index pair of columns on challenges consumed by a
 * five-argument overload of challenge_create(). Until this is true, Battle
 * Royale (src/routes/-app.battle-royale-page.tsx and
 * src/lib/battle-royale-client.ts) must not reference any of that — not the
 * wider cap, not a third argument to createChallenge() below, not a series
 * table or column.
 *
 * Flip it in the SAME commit that applies the migration, and only alongside
 * mobile's copy of this flag (gandd-mobile/lib/battle-royale-client.ts) —
 * both apps hit the same schema.
 */
export const BATTLE_SCHEMA_APPLIED = true;

/**
 * Has supabase/migrations/20260815120000_friend_search_prefix.sql landed?
 *
 * That migration adds public.find_students(), a handle-PREFIX search: three
 * characters minimum, ten results maximum, opt-in students only, handles never
 * display names.
 *
 * DETECTED, not hand-flipped. This was `FRIEND_SEARCH_PREFIX_APPLIED = false`,
 * a constant to be flipped in the same commit that applied the SQL. Migrations
 * here are applied by hand, so that made running the SQL do nothing until a
 * second code change also shipped — and mobile carries its own copy of the same
 * constant, so "flip both together" was one more thing to get wrong. The first
 * call now just tries the RPC; PostgREST's PGRST202 latches this for the rest
 * of the session and the search box falls back to the exact-handle lookup it
 * has always used.
 *
 * Only a missing FUNCTION latches it. A network blip must not, or one bad
 * moment would disable suggestions until a reload.
 */
let prefixSearchMissing = false;

function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { isGuestUser } from "@/lib/guest-session";

// The generated Database type does not know about the new RPCs, so calling them
// through the typed client would not compile. Same escape hatch as
// src/lib/studybody-data.ts, kept as narrow as possible.
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type SocialDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = supabase as unknown as SocialDb;

/**
 * Should any social surface be shown to this user at all?
 *
 * Guests are excluded, and the exclusion is meaningful rather than cosmetic: a
 * guest is a real Supabase ANONYMOUS auth user (see guest-session.ts) with a
 * genuine auth.uid() and a real profile row, so nothing about RLS keeps them
 * out on its own. They are excluded because an anonymous session is discarded
 * the moment it is signed out - a friendship with one is a promise the app
 * cannot keep - and because anonymous accounts can be minted on demand, which
 * would make every rate limit on the server worthless. The database enforces
 * the same rule independently; this only decides what is worth rendering.
 */
export function socialEnabled(user: User | null | undefined): boolean {
  return SOCIAL_SCHEMA_APPLIED && Boolean(user) && !isGuestUser(user);
}

/** Shape a student's handle must satisfy. Mirrors the CHECK constraint exactly. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(input: string): string {
  // The '@' and the spaces are forgiven rather than rejected. Every handle in
  // this app is DISPLAYED as "@ada", so typing it back that way is the expected
  // thing to do, not a mistake - and before this, "@ada" failed the shape guard
  // and came back as "no student found", which reads as "that person is not
  // here" rather than "drop the @".
  return input.trim().toLowerCase().replace(/^@+/, "").replace(/\s+/g, "");
}

export type Discoverability = "anyone" | "nobody";

export type FoundStudent = {
  user_id: string;
  username: string;
  display_name: string;
  points: number;
  /** 'self' | 'friends' | 'pending_out' | 'pending_in' | 'none' */
  relationship: string;
};

export type Friend = {
  user_id: string;
  username: string | null;
  display_name: string;
  points: number;
  current_streak: number;
  friends_since: string | null;
};

export type FriendRequest = {
  user_id: string;
  username: string | null;
  display_name: string;
  direction: "incoming" | "outgoing";
  created_at: string;
};

export type ChallengeSummary = {
  id: string;
  title: string;
  question_count: number;
  status: "pending" | "active" | "complete" | "expired" | "declined";
  i_am_challenger: boolean;
  opponent_user_id: string;
  opponent_username: string | null;
  opponent_name: string;
  my_score: number | null;
  my_duration_ms: number | null;
  my_finished_at: string | null;
  my_started: boolean;
  /** Null until you have finished your own sitting, or the challenge settles. */
  their_score: number | null;
  their_duration_ms: number | null;
  their_finished: boolean;
  outcome: "won" | "lost" | "draw" | null;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
};

const OFF = "Friends and challenges are not switched on yet.";

/**
 * Unwrap an RPC result, turning the database's message into the thrown error.
 *
 * The server-side messages are written to be shown to a student as-is, and none
 * of them distinguishes "no such handle" from "that student is not findable",
 * "that student blocked you" or "that is a guest account" - they are all the
 * same sentence, by design. Passing them through unedited is therefore safe and
 * is better than a generic fallback, which would hide the useful half (the rate
 * limits and the "already played" guards).
 */
function unwrap<T>(result: RpcResult): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ── Handles ─────────────────────────────────────────────────────────────────

/** Claim (or change) the caller's public handle. Returns the stored handle. */
export async function claimUsername(handle: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  const value = normalizeHandle(handle);
  // Checked here purely so a typo does not cost a round trip; the constraint,
  // the reserved list and the collision are all decided by the database.
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error("Handles are 3-20 characters, using a-z, 0-9 and underscore only.");
  }
  return unwrap<string>(await db.rpc("claim_username", { p_username: value }));
}

export async function setDiscoverability(mode: Discoverability): Promise<Discoverability> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<Discoverability>(await db.rpc("set_discoverability", { p_mode: mode }));
}

/**
 * Look a student up by their EXACT handle. Returns null for no match.
 *
 * Exact match is not a limitation waiting to be improved on - it is the design.
 * A prefix or fuzzy endpoint would let anyone walk the handle space and dump a
 * roster of identifiable medical and law students at named institutions; exact
 * match means you can only find someone whose handle you were already told.
 * The full argument is in docs/gamification-plan.md §3 and in the comment above
 * find_student() in the migration.
 *
 * Null is returned identically for: no such handle, a handle set to "nobody",
 * a guest account, someone who blocked you, and an input that is not a handle at
 * all. Nothing here can confirm or deny that an email address has an account,
 * because no email-shaped string ever reaches a query.
 */
export async function findStudent(handle: string): Promise<FoundStudent | null> {
  if (!SOCIAL_SCHEMA_APPLIED) return null;
  const value = normalizeHandle(handle);
  if (!USERNAME_PATTERN.test(value)) return null;
  const rows = unwrap<FoundStudent[] | null>(await db.rpc("find_student", { p_handle: value }));
  return rows?.[0] ?? null;
}

/**
 * Students whose handle STARTS with what has been typed — the type-ahead.
 *
 * Empty until 20260815120000_friend_search_prefix.sql is applied: find_students()
 * does not exist before then, and PostgREST answers a missing function with an
 * error rather than an empty result. Callers keep findStudent() as their
 * fallback, which is why this returns [] rather than throwing — an empty
 * suggestion list degrades into "type the whole handle", which is exactly the
 * behaviour that came before it.
 *
 * The three-character minimum is the server's, mirrored here only so a shorter
 * prefix does not cost a round trip. Everything that decides who is findable —
 * the opt-in flag, guests, blocks — is decided by the database.
 */
export async function findStudentsByPrefix(prefix: string, limit = 5): Promise<FoundStudent[]> {
  if (!SOCIAL_SCHEMA_APPLIED || prefixSearchMissing) return [];
  const value = normalizeHandle(prefix);
  if (!USERNAME_PATTERN.test(value)) return [];

  // Never throws, unlike its neighbours. The search box runs this alongside the
  // exact-handle lookup in ONE Promise.all, so a rejection here would discard
  // the exact result too and break a search that works perfectly well without
  // suggestions.
  const result = await db.rpc("find_students", { p_prefix: value, p_limit: limit });
  if (result.error) {
    if (isMissingFunction(result.error)) prefixSearchMissing = true;
    return [];
  }
  return (result.data as FoundStudent[] | null) ?? [];
}

// ── Friends ─────────────────────────────────────────────────────────────────

export async function friendList(): Promise<Friend[]> {
  if (!SOCIAL_SCHEMA_APPLIED) return [];
  return unwrap<Friend[] | null>(await db.rpc("friend_list")) ?? [];
}

export async function friendRequests(): Promise<FriendRequest[]> {
  if (!SOCIAL_SCHEMA_APPLIED) return [];
  return unwrap<FriendRequest[] | null>(await db.rpc("friend_requests_mine")) ?? [];
}

/** Sends by handle, not by id, so discoverability is re-checked at send time. */
export async function sendFriendRequest(handle: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("friend_request", { p_username: normalizeHandle(handle) }));
}

export async function respondToFriendRequest(userId: string, accept: boolean): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("friend_respond", { p_user_id: userId, p_accept: accept }));
}

export async function removeFriend(userId: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("friend_remove", { p_user_id: userId }));
}

export async function blockStudent(userId: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("friend_block", { p_user_id: userId }));
}

// ── Challenges ──────────────────────────────────────────────────────────────

/** Longest challenge the server will accept, mirrored from challenge_create. */
export const MAX_CHALLENGE_QUESTIONS = 12;
export const DEFAULT_CHALLENGE_QUESTIONS = 8;

/**
 * Turn a freshly generated, unplayed MCQ set into a challenge for a friend.
 * The set must be the caller's own, in progress, MCQ-only and untouched - the
 * server checks all four, because a set whose answers the challenger has already
 * seen is not a contest.
 *
 * Two callers: the challenge dialogs (src/components/challenge-friend-dialog.tsx)
 * never pass a limit, and Battle Royale (src/routes/-app.battle-royale-page.tsx)
 * passes one only once BATTLE_SCHEMA_APPLIED is true - see timeLimitMinutes below.
 */
export async function createChallenge(
  opponentHandle: string,
  sessionId: string,
  timeLimitMinutes?: number,
): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  // The third argument is OMITTED entirely unless a limit was given, and that is
  // load-bearing rather than tidy. Before 20260813120000_battle_royale.sql is
  // applied the only function in the database is challenge_create(TEXT, UUID);
  // naming p_time_limit_minutes against it fails the call outright. Sending two
  // keys works on BOTH schemas — after the migration the third parameter has a
  // DEFAULT, so a two-argument call still resolves and means "no limit".
  //
  // The caller is responsible for only passing a limit once BATTLE_SCHEMA_APPLIED
  // is true. Reading that flag here would be redundant — it is declared right
  // above in this same module.
  const args: Record<string, unknown> = {
    p_opponent_username: normalizeHandle(opponentHandle),
    p_session_id: sessionId,
  };
  if (typeof timeLimitMinutes === "number" && Number.isFinite(timeLimitMinutes)) {
    args.p_time_limit_minutes = Math.round(timeLimitMinutes);
  }
  return unwrap<string>(await db.rpc("challenge_create", args));
}

/**
 * Open (or resume) the caller's sitting and get the session to navigate to.
 * The server stamps the start time on the first call and never restarts it.
 */
export async function beginChallenge(
  challengeId: string,
): Promise<{ sessionId: string; planId: string }> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  const rows = unwrap<Array<{ session_id: string; plan_id: string }> | null>(
    await db.rpc("challenge_begin", { p_challenge_id: challengeId }),
  );
  const row = rows?.[0];
  if (!row?.session_id) throw new Error("Could not open that challenge.");
  return { sessionId: row.session_id, planId: row.plan_id };
}

/**
 * Called by the practice screen the moment a set is submitted.
 *
 * This is what makes the tie-break honest: the finish time is stamped by the
 * SERVER, here, rather than taken from the device. Two phones' clocks disagree
 * by minutes as a matter of course, and a client-reported duration is not merely
 * inaccurate - it is a number the client chooses, which would decide every close
 * contest.
 *
 * Deliberately swallows its errors. Practice must never fail because a social
 * feature did, and nothing is lost if this call does not land: the answers are
 * already stored, and opening the challenge list re-runs the same recount (see
 * listChallenges). A late stamp only ever lengthens the player's own duration,
 * so failing here can never win a tie-break it should have lost.
 *
 * A no-op for an ordinary practice session, so callers do not need to know
 * whether the session is part of a challenge.
 */
export async function submitChallengeForSession(sessionId: string): Promise<void> {
  if (!SOCIAL_SCHEMA_APPLIED) return;
  try {
    await db.rpc("challenge_submit_for_session", { p_session_id: sessionId });
  } catch (err) {
    console.warn("challenge result not submitted; it will be recovered from the list", err);
  }
}

/** Recovery path for a sitting whose submit never reached the server. */
export async function submitChallenge(challengeId: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("challenge_submit", { p_challenge_id: challengeId }));
}

export async function declineChallenge(challengeId: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("challenge_decline", { p_challenge_id: challengeId }));
}

export async function cancelChallenge(challengeId: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<string>(await db.rpc("challenge_cancel", { p_challenge_id: challengeId }));
}

/**
 * The caller's challenges, newest first.
 *
 * Sweeps first: any sitting that finished without its result reaching the
 * server is recounted and stamped, and anything past its deadline is resolved.
 * That makes opening this list the recovery mechanism, so the feature does not
 * depend on a scheduled job somebody has to remember to set up.
 */
export async function listChallenges(limit = 40): Promise<ChallengeSummary[]> {
  if (!SOCIAL_SCHEMA_APPLIED) return [];
  try {
    await db.rpc("challenge_sync_mine");
  } catch (err) {
    // A failed sweep costs freshness, never correctness - show what is stored.
    console.warn("challenge sync failed", err);
  }
  return (
    unwrap<ChallengeSummary[] | null>(await db.rpc("challenge_list_mine", { p_limit: limit })) ?? []
  );
}

/** "2m 41s" — challenge times are short, so minutes and seconds is enough. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
