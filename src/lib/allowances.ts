// Rank rewards: the daily upload allowance and the Deep Study Pass.
//
// ── WHAT IS ENFORCED ────────────────────────────────────────────────────────
// The daily upload allowance IS enforced (owner's call, made explicitly). Base
// 3 a day, plus whatever the student's five-day activity and rank have added,
// counted in FILES — a folder of ten PDFs spends ten, not one, because ten
// files is ten extractions and ten sets of embeddings. It resets on the same
// UTC day boundary the rest of the gamification ledger uses.
//
// ── TWO INDEPENDENT AXES, NOT ONE LADDER ────────────────────────────────────
// The ceiling is 7/day, reached by 3 (base) + 2 (EARNED_DAY_UPLOAD_BONUS, once
// ACTIVE_DAYS_FOR_BONUS days of activity have accrued — see activeDays in
// gamification.ts) + 2 (RANKS[].uploadBonus at Academic Scout and above). The
// two bonuses are independent: a five-day-old Recruit sits at 5, a same-day
// Cadet who rushed 50 points sits at 4, and only a student who has BOTH stuck
// around and studied enough reaches 7. This is deliberate — one axis rewards
// showing up, the other rewards depth, and the owner wants both, not either.
//
// Two rules the copy has to keep:
//   1. Never punitive. The allowance is something a student earns MORE of; the
//      messages say when the next ones arrive and which rank raises the number.
//   2. Never silently drop a file. A batch bigger than the remaining allowance
//      uploads as much as it can and names what is left over — it does not fail
//      the whole batch, and it does not quietly take the first few.
//
// This is a client-side check. localStorage is trivially editable, so a student
// who opens dev tools can reset the counter. That is accepted for now: the
// cost being defended is extraction + embedding spend from ordinary bulk
// dropping, not adversarial abuse. Real enforcement needs a server-side counter
// (see docs/gamification-plan.md).
//
// The Deep Study Pass is a different posture: the grant and expiry are real and
// NOTHING consumes them, because a deep response costs money and wiring a quota
// to spend is a product decision with a bill attached.

import { RANKS, rankIndexFromPoints } from "@/lib/ranks";

/**
 * Uploads a day before either bonus. See the header note above for the full
 * ladder — this is the floor everyone starts on, including a guest.
 */
export const BASE_DAILY_UPLOADS = 3;

/**
 * The showing-up bonus: +2 a day once a student has been active on
 * ACTIVE_DAYS_FOR_BONUS separate days — any five, not five in a row, per the
 * owner's explicit call. "Active" means anything that calls
 * recordGamificationEvent(), which is also what advances lastActiveDate, so
 * activeDays (src/lib/gamification.ts) rolls over in exactly the same place.
 * Missing a weekend costs nothing: the counter only ever goes up.
 */
export const EARNED_DAY_UPLOAD_BONUS = 2;
export const ACTIVE_DAYS_FOR_BONUS = 5;

/**
 * The master switch. While false, `uploadAllowance().blocked` is always false
 * and the Library shows the allowance as an earned expansion with no teeth.
 * ON since the owner asked for enforcement — see the header note.
 */
export const ENFORCE_UPLOAD_LIMIT = true;

const UPLOAD_COUNT_PREFIX = "gd:uploads:";
const DEEP_PASS_PREFIX = "gd:deep-pass:";

/** Deep responses a pass is worth, and how long it lasts. */
export const DEEP_PASS_USES = 5;
export const DEEP_PASS_HOURS = 24;

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Blocked storage: the counter simply does not persist. Since nothing is
    // enforced, the only consequence is a display that resets.
  }
}

export type UploadAllowance = {
  base: number;
  /** EARNED_DAY_UPLOAD_BONUS if earnedBonusUnlocked, else 0 — its own field so
   *  a caller can name where the number came from rather than just the total. */
  earnedBonus: number;
  /** Whether the five-active-days bonus has been reached. */
  earnedBonusUnlocked: boolean;
  /** Extra uploads the student's rank has earned. */
  rankBonus: number;
  /** base + earnedBonus + rankBonus. */
  total: number;
  usedToday: number;
  remaining: number;
  /** Always false while ENFORCE_UPLOAD_LIMIT is off. */
  blocked: boolean;
  /** The rank the bonus came from, for the "rank bonus +2" line. */
  rankName: string;
  /** The next rank that RAISES the allowance, or null at the top of the ladder. */
  nextBonusRankName: string | null;
  /** What the daily allowance becomes at that rank. */
  nextBonusTotal: number | null;
  /** Points still needed to reach it, so the upsell can say how far away it is. */
  nextBonusPointsAway: number | null;
};

export function uploadAllowance(
  userId: string,
  points: number,
  activeDays: number,
): UploadAllowance {
  return allowanceFrom(points, uploadsUsedToday(userId), activeDays);
}

/** The pure form, for callers that already hold today's count and active-day tally in state. */
export function allowanceFrom(
  points: number,
  usedToday: number,
  activeDays: number,
): UploadAllowance {
  const safePoints = Number.isFinite(points) ? Math.max(0, points) : 0;
  const index = rankIndexFromPoints(points);
  const rank = RANKS[index];
  const earnedBonusUnlocked = Number.isFinite(activeDays) && activeDays >= ACTIVE_DAYS_FOR_BONUS;
  const earnedBonus = earnedBonusUnlocked ? EARNED_DAY_UPLOAD_BONUS : 0;
  const total = BASE_DAILY_UPLOADS + earnedBonus + rank.uploadBonus;
  const remaining = Math.max(0, total - usedToday);
  // The next rank that actually moves the number — several early ranks share a
  // bonus, so "reach the next rank" would be a lie at Academic Recruit.
  const upgrade = RANKS.slice(index + 1).find((r) => r.uploadBonus > rank.uploadBonus) ?? null;
  return {
    base: BASE_DAILY_UPLOADS,
    earnedBonus,
    earnedBonusUnlocked,
    rankBonus: rank.uploadBonus,
    total,
    usedToday,
    remaining,
    blocked: ENFORCE_UPLOAD_LIMIT && remaining <= 0,
    rankName: rank.name,
    nextBonusRankName: upgrade?.name ?? null,
    nextBonusTotal: upgrade ? BASE_DAILY_UPLOADS + earnedBonus + upgrade.uploadBonus : null,
    nextBonusPointsAway: upgrade ? Math.max(0, upgrade.threshold - safePoints) : null,
  };
}

/**
 * When today's count rolls over. The ledger key is a UTC date (same as
 * gamification.ts), so the boundary is 00:00 UTC — which is 1am in Lagos, not
 * local midnight. The label renders that instant in the student's own clock so
 * the message is true wherever they are rather than approximately true here.
 */
export function nextUploadReset(now = new Date()): Date {
  const reset = new Date(now.getTime());
  reset.setUTCHours(24, 0, 0, 0);
  return reset;
}

export function uploadResetLabel(now = new Date()): string {
  try {
    return nextUploadReset(now).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "midnight";
  }
}

/**
 * The upsell, as its own sentence: which rank raises the allowance, what it
 * becomes, and how far away it is. Empty once the allowance has topped out, so
 * no message ever dangles a reward that does not exist.
 */
export function uploadUpgradeSentence(allowance: UploadAllowance): string {
  const { nextBonusRankName: name, nextBonusTotal: total, nextBonusPointsAway: away } = allowance;
  if (!name || total == null || away == null) return "";
  if (away <= 0) return `${name} is already yours — that's ${total} a day.`;
  return `${away} more ${away === 1 ? "point" : "points"} reaches ${name}: ${total} uploads a day.`;
}

export type UploadBatchPlan = {
  /** How many of the selected files to upload now. */
  accepted: number;
  /** How many are waiting for tomorrow's allowance. */
  deferred: number;
  /** Null when the whole batch fits — nothing to say. */
  message: string | null;
};

/**
 * Decide how much of a selected batch today's allowance covers.
 *
 * Deliberately partial rather than all-or-nothing: a student who drags a folder
 * of twelve slides should get their three, not an error. The message always
 * carries the two facts the owner insists on — when the rest arrive, and which
 * rank raises the number.
 */
export function planUploadBatch(allowance: UploadAllowance, requested: number): UploadBatchPlan {
  const wanted = Math.max(0, Math.round(requested));
  if (!ENFORCE_UPLOAD_LIMIT) return { accepted: wanted, deferred: 0, message: null };

  const accepted = Math.min(wanted, allowance.remaining);
  const deferred = wanted - accepted;
  if (deferred <= 0) return { accepted, deferred: 0, message: null };

  const at = uploadResetLabel();
  const upgrade = uploadUpgradeSentence(allowance);
  const tail = upgrade ? ` ${upgrade}` : "";
  if (accepted === 0) {
    return {
      accepted: 0,
      deferred,
      message:
        `That's all ${allowance.total} of today's uploads used. ` +
        `Your next ${allowance.total} arrive at ${at}.${tail}`,
    };
  }
  return {
    accepted,
    deferred,
    message:
      `Uploading ${accepted} of ${wanted} — the rest of today's ${allowance.total}. ` +
      `The other ${deferred} ${deferred === 1 ? "is" : "are"} ready to add at ${at}.${tail}`,
  };
}

export function uploadsUsedToday(userId: string): number {
  const stored = readJson<{ date: string; count: number }>(`${UPLOAD_COUNT_PREFIX}${userId}`);
  if (!stored || stored.date !== todayKey()) return 0;
  return Math.max(0, Math.round(stored.count));
}

/** Record uploads against today's allowance. Counting is on even when the cap is not. */
export function recordUploads(userId: string, count = 1): number {
  const next = uploadsUsedToday(userId) + Math.max(0, count);
  writeJson(`${UPLOAD_COUNT_PREFIX}${userId}`, { date: todayKey(), count: next });
  return next;
}

/**
 * The earned-expansion phrasing the owner asked for: "3/3, rank bonus +2, 5
 * available" rather than anything that reads as a restriction. With no bonus
 * yet, it names the rank that unlocks the first one instead of showing "+0".
 */
export function uploadAllowanceLabel(allowance: UploadAllowance): string {
  const used = `${Math.min(allowance.usedToday, allowance.total)}/${allowance.total} used today`;
  const upgrade =
    allowance.nextBonusRankName && allowance.nextBonusPointsAway
      ? `${allowance.nextBonusPointsAway} ${allowance.nextBonusPointsAway === 1 ? "pt" : "pts"} to ${allowance.nextBonusRankName} for ${allowance.nextBonusTotal} a day`
      : null;

  // Spent for the day: lead with when they come back, not with the zero.
  if (allowance.remaining === 0) {
    const parts = [used, `${allowance.total} more at ${uploadResetLabel()}`];
    if (upgrade) parts.push(upgrade);
    return parts.join(" · ");
  }
  const parts = [used];
  // Two independent bonuses can both be live at once (a five-day-old Scout has
  // both), so each names itself rather than folding into one opaque number.
  if (allowance.earnedBonusUnlocked) parts.push(`+${allowance.earnedBonus} for 5 days active`);
  if (allowance.rankBonus > 0) parts.push(`rank bonus +${allowance.rankBonus}`);
  if (upgrade) parts.push(upgrade);
  else parts.push(`${allowance.total} available`);
  return parts.join(" · ");
}

export type DeepStudyPass = {
  grantedAt: string;
  expiresAt: string;
  usesRemaining: number;
};

/**
 * Grant a pass: DEEP_PASS_USES deep responses, valid for DEEP_PASS_HOURS.
 * Re-granting while one is live tops the uses back up and extends the window
 * rather than stacking passes, which keeps the accounting a single row.
 */
export function grantDeepStudyPass(userId: string, now = new Date()): DeepStudyPass {
  const pass: DeepStudyPass = {
    grantedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DEEP_PASS_HOURS * 3_600_000).toISOString(),
    usesRemaining: DEEP_PASS_USES,
  };
  writeJson(`${DEEP_PASS_PREFIX}${userId}`, pass);
  return pass;
}

/** The live pass, or null when there is none or it has expired. */
export function getDeepStudyPass(userId: string, now = new Date()): DeepStudyPass | null {
  const stored = readJson<DeepStudyPass>(`${DEEP_PASS_PREFIX}${userId}`);
  if (!stored) return null;
  if (new Date(stored.expiresAt).getTime() <= now.getTime()) return null;
  if (stored.usesRemaining <= 0) return null;
  return stored;
}

/**
 * Spend one use. NOT CALLED ANYWHERE YET — a deep response is the expensive
 * model tier, and metering it is a decision about money, so it is reported
 * rather than wired. See the header note.
 */
export function consumeDeepStudyPass(userId: string, now = new Date()): DeepStudyPass | null {
  const pass = getDeepStudyPass(userId, now);
  if (!pass) return null;
  const next: DeepStudyPass = { ...pass, usesRemaining: pass.usesRemaining - 1 };
  writeJson(`${DEEP_PASS_PREFIX}${userId}`, next);
  return next;
}
