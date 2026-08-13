// Friends and asynchronous challenges — native twin of src/lib/social.ts.
//
// ── SAME FLAG, SAME SCHEMA, SAME BACKEND ────────────────────────────────────
// Mobile and web hit the same Supabase project, so there is exactly one truth
// about whether the social migration has run: src/lib/social.ts's
// SOCIAL_SCHEMA_APPLIED. That flag was flipped to true on 2026-08-09 (commit
// "feat: switch on friends and async challenges") once the owner verified the
// migration — usernames, discoverable_by, friendships, challenges,
// challenge_participants and the RPCs below — was applied in production. This
// constant mirrors that verified state; it must be flipped back to false the
// moment (and only the moment) the web flag is, never independently.
//
// With it false, this module makes no network call of any kind: every read
// returns an empty result before it reaches Supabase, every write throws
// locally, and `socialEnabled()` is false so no entry point renders. Naming a
// column, view or function that does not exist makes PostgREST reject the
// WHOLE statement — not the one field — which is how uploads went down once
// already, so every reference to the new schema is behind this flag.
export const SOCIAL_SCHEMA_APPLIED = true;

import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

// The generated types (there is no generated Database type at all on mobile —
// see lib/studybody-data.ts's `db` escape hatch) don't know about these RPCs,
// so the call goes through the same narrow, unsafe-cast client.
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type SocialDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = supabase as unknown as SocialDb;

/**
 * Should any social surface be shown to this user at all?
 *
 * Unlike the web there is no anonymous/guest session on mobile (native auth is
 * email or Google only — see lib/auth.tsx), so the only gate here is the
 * schema flag and whether anyone is signed in.
 */
export function socialEnabled(user: User | null | undefined): boolean {
  return SOCIAL_SCHEMA_APPLIED && Boolean(user);
}

/** Shape a student's handle must satisfy. Mirrors the CHECK constraint exactly. */
export const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export function normalizeHandle(input: string): string {
  return input.trim().toLowerCase();
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

/** Unwrap an RPC result, turning the database's message into the thrown error. */
function unwrap<T>(result: RpcResult): T {
  if (result.error) throw new Error(result.error.message);
  return result.data as T;
}

// ── Handles ─────────────────────────────────────────────────────────────────

/** Claim (or change) the caller's public handle. Returns the stored handle. */
export async function claimUsername(handle: string): Promise<string> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  const value = normalizeHandle(handle);
  if (!USERNAME_PATTERN.test(value)) {
    throw new Error("Handles are 3-20 characters, using a-z, 0-9 and underscore only.");
  }
  return unwrap<string>(await db.rpc("claim_username", { p_username: value }));
}

export async function setDiscoverability(mode: Discoverability): Promise<Discoverability> {
  if (!SOCIAL_SCHEMA_APPLIED) throw new Error(OFF);
  return unwrap<Discoverability>(await db.rpc("set_discoverability", { p_mode: mode }));
}

/** Look a student up by their EXACT handle. Returns null for no match. */
export async function findStudent(handle: string): Promise<FoundStudent | null> {
  if (!SOCIAL_SCHEMA_APPLIED) return null;
  const value = normalizeHandle(handle);
  if (!USERNAME_PATTERN.test(value)) return null;
  const rows = unwrap<FoundStudent[] | null>(await db.rpc("find_student", { p_handle: value }));
  return rows?.[0] ?? null;
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
 * Turn an existing, unplayed, MCQ-only session into a challenge for a friend.
 * The server checks all three (in progress, MCQ-only, untouched) — a set whose
 * answers the challenger has already seen is not a contest.
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
  // is true. Reading that flag here would be circular: battle-royale-client.ts
  // already imports from this module.
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
 * Tell the server a sitting is finished, NOW, so the tie-break time is stamped
 * by the server's clock rather than reported by the device — duration decides
 * every drawn contest, and a device-chosen number is not merely inaccurate.
 *
 * Called from My Coach when any set completes: it no-ops for an ordinary
 * practice set, and returns before any network call while SOCIAL_SCHEMA_APPLIED
 * is false. It never throws, because practice must not fail on account of a
 * social feature — opening the challenge list recovers a result that did not
 * land here, via submitChallenge() below.
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
 */
export async function listChallenges(limit = 40): Promise<ChallengeSummary[]> {
  if (!SOCIAL_SCHEMA_APPLIED) return [];
  try {
    await db.rpc("challenge_sync_mine");
  } catch (err) {
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
