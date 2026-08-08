// When the celebratory moments are allowed to fire.
//
// Same shape and the same failure posture as src/lib/announcement.ts: a
// versioned localStorage key, and a blocked-storage fallback that reports
// "already seen". A student in private mode gets no confetti; a student in
// private mode trapped behind a dialog that reopens on every navigation would
// be a bug, so that is the direction the fallback leans.
//
// Neither of these is a server concern. Celebrating a rank once per device is
// the right granularity for something purely decorative, and it keeps the whole
// feature free of a migration.

import { RANKS, rankIndexFromPoints, type AcademicRank } from "@/lib/ranks";

const RANK_SEEN_KEY = "gd_rank_celebrated_v1";
const STREAK_OPEN_KEY = "gd_streak_opening_seen_v1";

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Worst case the moment offers itself again next session.
  }
}

function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The rank to celebrate right now, or null.
 *
 * Called with the student's current points on every stats change and on mount,
 * so it must be idempotent: it records the highest rank index already
 * celebrated and only ever returns something when the current rank is above it.
 *
 * The first call for a device is a special case. An existing student sitting on
 * 4,000 points has "crossed" seven thresholds as far as this function can tell,
 * and firing seven celebrations (or even one, for a rank they earned weeks ago)
 * would be a lie. So a device with no record is seeded silently at the
 * student's current rank, and only genuinely new crossings are celebrated.
 */
export function takeRankCelebration(points: number): AcademicRank | null {
  if (typeof window === "undefined") return null;
  const currentIndex = rankIndexFromPoints(points);
  const stored = readString(RANK_SEEN_KEY);

  if (stored == null) {
    writeString(RANK_SEEN_KEY, String(currentIndex));
    return null;
  }

  const seenIndex = Number.parseInt(stored, 10);
  if (!Number.isFinite(seenIndex)) {
    writeString(RANK_SEEN_KEY, String(currentIndex));
    return null;
  }
  // Points can only fall (a streak break), and a demotion is not a moment.
  if (currentIndex <= seenIndex) return null;

  // Mark it seen the instant it is handed out, not when the animation is
  // dismissed: a tab closed mid-celebration must not replay it forever.
  writeString(RANK_SEEN_KEY, String(currentIndex));
  return RANKS[currentIndex] ?? null;
}

/**
 * Whether the opening streak moment may run today, on this device.
 *
 * Returns false for a 0-day streak: there is nothing to be on fire about, and a
 * "welcome back" card in front of a student who has not studied yet is noise
 * standing between them and the product. Consumes the day the moment it says
 * yes, so navigating between pages cannot replay it.
 */
export function takeStreakOpening(currentStreak: number): boolean {
  if (typeof window === "undefined") return false;
  if (currentStreak < 1) return false;
  const today = todayKey();
  if (readString(STREAK_OPEN_KEY) === today) return false;
  writeString(STREAK_OPEN_KEY, today);
  return true;
}

/** True when the OS asks for less motion. Read at call time, never cached. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
