// The server-side points ledger: the one place point_events is named.
//
// ── OFF UNTIL THE MIGRATION IS APPLIED ──────────────────────────────────────
// Depends on public.points_summary(), created by
// supabase/migrations/20260810120200_point_events_ledger.sql, which the owner
// applies by hand. PostgREST rejects a whole call that names a function it does
// not have, so every reference is behind this flag; with it false nothing here
// makes a network call.
//
// Flip it to true in the SAME commit that applies the migration.
export const POINTS_LEDGER_APPLIED = false;

import { supabase } from "@/integrations/supabase/client";
import { reconcilePointsFromServer, type ServerAward } from "@/lib/gamification";

// The generated Database type does not know about the new RPC, so calling it
// through the typed client would not compile. Same escape hatch as
// src/lib/social.ts, kept as narrow as possible.
type RpcResult = { data: unknown; error: { message: string; code?: string } | null };
type LedgerDb = { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult> };
const db = supabase as unknown as LedgerDb;

const CURSOR_PREFIX = "gd:points-cursor:";

/**
 * The id of the newest server award this device has already folded into its
 * local cache.
 *
 * point_events ids come from one monotonic identity sequence, so "everything
 * greater than the last id I absorbed" is exact. No set of seen ids to keep, no
 * timestamps, and nothing that a clock disagreement between the phone and the
 * database can get wrong.
 */
function readCursor(userId: string): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(`${CURSOR_PREFIX}${userId}`);
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function writeCursor(userId: string, value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(`${CURSOR_PREFIX}${userId}`, String(value));
}

export type ReconcileResult = {
  /** Points the server had granted that this device had not yet counted. */
  applied: number;
  /** The server's own total, when it told us one. */
  serverTotal: number | null;
};

/**
 * Fold anything the server has awarded into the local display cache.
 *
 * WHAT HAPPENS WHEN THE TWO DISAGREE, stated plainly, because during Stage A
 * they always will:
 *
 *   * The browser is still the one that decides every ordinary award (finishing
 *     a set, correct answers, streaks, weekend missions) and keeps the running
 *     total in localStorage.
 *   * The server decides the awards it can prove - today that is exactly one,
 *     the challenge win - and records them in point_events.
 *   * Neither total is complete on its own, so neither can simply overwrite the
 *     other. Instead this adds the server's awards the cache has not seen, by
 *     id. The cache is never lowered by a reconcile, and a server award can
 *     never be counted twice however many times this runs.
 *
 * That means a student who edits their localStorage total keeps the inflated
 * number until Stage B - this is a display reconcile, not an audit, and it is
 * not pretending otherwise. What it does guarantee is the direction that
 * matters right now: a win the server granted is never silently lost when the
 * browser next pushes its own total over user_profiles.points.
 *
 * In Stage B (see the foot of the ledger migration) this function inverts: the
 * server total becomes authoritative and the cache is overwritten from it, up
 * or down.
 *
 * Never throws. Points reconciliation failing is not a reason to break a page.
 */
export async function reconcileServerPoints(userId: string): Promise<ReconcileResult> {
  const none: ReconcileResult = { applied: 0, serverTotal: null };
  if (!POINTS_LEDGER_APPLIED || !userId || userId === "guest") return none;
  try {
    const since = readCursor(userId);
    const { data, error } = await db.rpc("points_summary", { p_since_id: since, p_limit: 50 });
    if (error) return none;
    const rows = (data as Record<string, unknown>[] | null) ?? [];
    if (rows.length === 0) return none;

    const awards: ServerAward[] = [];
    let highest = since;
    let serverTotal: number | null = null;
    for (const row of rows) {
      const id = Number(row.award_id);
      const points = Number(row.points);
      if (!Number.isFinite(id) || !Number.isFinite(points)) continue;
      if (typeof row.server_total === "number") serverTotal = row.server_total;
      if (id <= since) continue;
      highest = Math.max(highest, id);
      awards.push({
        id: `srv-${id}`,
        type: String(row.event_type ?? ""),
        points,
        createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
      });
    }

    // Oldest first, so the local event list ends up in the same order a student
    // would have seen them happen.
    awards.reverse();
    const applied = reconcilePointsFromServer(userId, awards);
    // The cursor moves whether or not anything was applied: an award that
    // reconcilePointsFromServer chose not to double-count is still absorbed.
    if (highest > since) writeCursor(userId, highest);
    return { applied, serverTotal };
  } catch {
    return none;
  }
}
