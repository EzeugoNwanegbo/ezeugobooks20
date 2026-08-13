// Academic ranks — the named progression that replaces the anonymous "L7".
//
// A rank is derived purely from a point total, so there is no extra state to
// store, migrate or keep in sync: every surface that knows a student's points
// can name their rank. `levelFromPoints` still exists in gamification.ts for
// anything that has not been migrated, but nothing user-facing uses it now.
//
// Thresholds are the owner's table, unchanged. Adding a rank is a one-line edit
// here; everything downstream (badge, progress bar, upload allowance) reads the
// table rather than hard-coding names.

export type RankTier = 0 | 1 | 2 | 3;

export type AcademicRank = {
  /** Stable key, for anything that needs to name a rank in storage. */
  id: string;
  name: string;
  /** Points at which this rank is reached. */
  threshold: number;
  /** Visual weight of the badge. Not a hue — see rank-badge.tsx. */
  tier: RankTier;
  /** Extra daily uploads this rank has earned, on top of the base allowance. */
  uploadBonus: number;
};

/**
 * ── DO NOT INSERT, REMOVE OR REORDER ROWS ───────────────────────────────────
 * takeRankCelebration() in progression-moments.ts persists the highest rank
 * already celebrated as an INDEX into this array. Inserting a rank shifts every
 * index above it, which silently re-points every existing student's record at
 * the wrong rank and fires a spurious celebration for a rank they have held for
 * weeks. Editing a `threshold` in place is safe — indices are unchanged, and a
 * student whom a lowered threshold promotes gets exactly one celebration.
 *
 * ── UPLOAD ALLOWANCE: 5 → 10 → 15 ───────────────────────────────────────────
 * `uploadBonus` is an addition to BASE_DAILY_UPLOADS (5), not a total. The
 * owner's three tiers are 5/day unranked, 10/day from the first upgrade, 15/day
 * later, so the bonuses are 0, +5, +10. Knowledge Cadet sits at 50 points —
 * about one good session — because the first upgrade is meant to land fast
 * enough to read as a reward. Every rank from Academic Scout up shares +10:
 * the ladder tops out at 15 uploads a day by design, and the ranks above Scout
 * are worth reaching for the title and the leaderboard rather than for more
 * uploads. Raising the ceiling later is a one-column edit here.
 */
export const RANKS: AcademicRank[] = [
  { id: "recruit", name: "Academic Recruit", threshold: 0, tier: 0, uploadBonus: 0 },
  { id: "cadet", name: "Knowledge Cadet", threshold: 50, tier: 0, uploadBonus: 5 },
  { id: "scout", name: "Academic Scout", threshold: 250, tier: 1, uploadBonus: 10 },
  { id: "corporal", name: "Scholar Corporal", threshold: 500, tier: 1, uploadBonus: 10 },
  { id: "sergeant", name: "Knowledge Sergeant", threshold: 1000, tier: 1, uploadBonus: 10 },
  { id: "lieutenant", name: "Academic Lieutenant", threshold: 2000, tier: 2, uploadBonus: 10 },
  { id: "captain", name: "Scholar Captain", threshold: 3500, tier: 2, uploadBonus: 10 },
  { id: "major", name: "Academic Major", threshold: 5000, tier: 2, uploadBonus: 10 },
  { id: "colonel", name: "Knowledge Colonel", threshold: 7500, tier: 3, uploadBonus: 10 },
  { id: "commander", name: "Academic Commander", threshold: 10000, tier: 3, uploadBonus: 10 },
  { id: "general", name: "Academic General", threshold: 15000, tier: 3, uploadBonus: 10 },
];

/** Index of the rank a point total sits in. Never returns -1: 0 points is a rank. */
export function rankIndexFromPoints(points: number): number {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  let index = 0;
  for (let i = 0; i < RANKS.length; i += 1) {
    if (safe >= RANKS[i].threshold) index = i;
    else break;
  }
  return index;
}

export function rankFromPoints(points: number): AcademicRank {
  return RANKS[rankIndexFromPoints(points)];
}

/**
 * How many daily uploads this rank ADDS over the rank below it — 0 for the
 * ranks that share a bonus with their predecessor. Anything that congratulates
 * a student on a bigger allowance must check this rather than `uploadBonus`,
 * which is the total bonus and is non-zero for ranks that changed nothing.
 */
export function uploadBonusGain(rank: AcademicRank): number {
  const index = RANKS.findIndex((r) => r.id === rank.id);
  if (index <= 0) return rank.uploadBonus;
  return Math.max(0, rank.uploadBonus - RANKS[index - 1].uploadBonus);
}

export type RankProgress = {
  rank: AcademicRank;
  /** The rank above, or null at Academic General (the top of the ladder). */
  next: AcademicRank | null;
  /** 0-100. Held at 100 once the top rank is reached, so bars never look unfinished. */
  percent: number;
  /** Points earned since entering the current rank. */
  earnedInRank: number;
  /** Size of the current rank's band, or 0 at the top. */
  bandSize: number;
  /** Points still needed for the next rank, or 0 at the top. */
  pointsToNext: number;
};

export function rankProgress(points: number): RankProgress {
  const safe = Number.isFinite(points) ? Math.max(0, points) : 0;
  const index = rankIndexFromPoints(safe);
  const rank = RANKS[index];
  const next = RANKS[index + 1] ?? null;
  if (!next) {
    return {
      rank,
      next: null,
      percent: 100,
      earnedInRank: safe - rank.threshold,
      bandSize: 0,
      pointsToNext: 0,
    };
  }
  const bandSize = next.threshold - rank.threshold;
  const earnedInRank = safe - rank.threshold;
  return {
    rank,
    next,
    percent: Math.max(0, Math.min(100, Math.round((earnedInRank / bandSize) * 100))),
    earnedInRank,
    bandSize,
    pointsToNext: Math.max(0, next.threshold - safe),
  };
}

/**
 * Every rank crossed moving from `before` points to `after` points, in order.
 * Used by the rank-up moment: a single big award can span two thresholds, and
 * the student should be told about the one they landed on, not the first.
 */
export function ranksCrossed(before: number, after: number): AcademicRank[] {
  if (after <= before) return [];
  return RANKS.filter((rank) => rank.threshold > before && rank.threshold <= after);
}
