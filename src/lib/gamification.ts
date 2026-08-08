import { supabase } from "@/integrations/supabase/client";

export type GamificationEvent =
  | "chat_entered"
  | "coach_question_correct"
  | "coach_question_failed"
  | "coach_session_completed"
  | "coach_timed_challenge"
  | "coach_beat_timer"
  | "weekend_mission"
  | "streak_milestone"
  | "roadmap_completed"
  | "streak_broken"
  // Multiplayer. The constants are defined so the points table is reviewable in
  // one place, but NOTHING records them — see docs/gamification-plan.md. They
  // stay unwired until points are server-authoritative.
  | "pvp_win"
  | "boss_battle_win";

/** Per-day ledger backing the anti-farming caps. Reset lazily when the date rolls. */
export type GamificationDaily = {
  date: string;
  /** Positive points already banked today, per event type. */
  earned: Partial<Record<GamificationEvent, number>>;
  /** Event types already taken today under `oncePerDay`. */
  once: Partial<Record<GamificationEvent, true>>;
};

export type GamificationStats = {
  points: number;
  weeklyPoints: number;
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string | null;
  lastChatRewardDate: string | null;
  correctQuestions: number;
  failedQuestions: number;
  roadmapsCompleted: number;
  /** Streak lengths whose bonus has already been paid, so it pays once ever. */
  streakMilestonesAwarded: number[];
  daily: GamificationDaily;
  events: Array<{
    id: string;
    type: GamificationEvent;
    points: number;
    createdAt: string;
    label: string;
  }>;
};

const STORAGE_PREFIX = "gd:gamification:";

export const EVENT_POINTS: Record<GamificationEvent, number> = {
  chat_entered: 2,
  coach_question_correct: 10,
  coach_question_failed: -2,
  // A finished question set. Deliberately left at its existing 15 rather than
  // dropped to the spec's 10: lowering a live award silently devalues what
  // students already earned, and 15 is the number the app has been paying.
  coach_session_completed: 15,
  // Opting into the timer, and beating it. Both stack on top of the set award.
  coach_timed_challenge: 10,
  coach_beat_timer: 5,
  weekend_mission: 15,
  streak_milestone: 0, // the real value comes from STREAK_MILESTONES below
  roadmap_completed: 100,
  streak_broken: -5,
  pvp_win: 20,
  boss_battle_win: 50,
};

const EVENT_LABELS: Record<GamificationEvent, string> = {
  chat_entered: "Entered chat",
  coach_question_correct: "Correct My Coach answer",
  coach_question_failed: "Missed My Coach question",
  coach_session_completed: "Completed My Coach session",
  coach_timed_challenge: "Timed challenge completed",
  coach_beat_timer: "Beat the clock",
  weekend_mission: "Weekend mission",
  streak_milestone: "Streak milestone",
  roadmap_completed: "Completed roadmap",
  streak_broken: "Streak break",
  pvp_win: "Won a battle",
  boss_battle_win: "Beat a boss",
};

/**
 * The hard requirement: a student must not be able to farm points by
 * regenerating easy questions. Each number is the MOST positive points that
 * event type can pay in one day. Negative events are never capped — a penalty
 * that stops applying is a loophole, not a mercy.
 *
 * The tightest one is coach_question_correct: at 10 points each and no cap, a
 * 50-question set of easy MCQs paid 500 points, which is two ranks. 120 is
 * roughly one honest 12-question set; everything after that is practice for its
 * own sake, which is the point of the product.
 */
export const DAILY_POINT_CAPS: Partial<Record<GamificationEvent, number>> = {
  chat_entered: 2,
  coach_question_correct: 120,
  coach_session_completed: 45,
  coach_timed_challenge: 30,
  coach_beat_timer: 15,
  weekend_mission: 15,
  roadmap_completed: 100,
};

/** Streak lengths that pay a one-off bonus, and what each pays. */
export const STREAK_MILESTONES: Array<{ days: number; points: number }> = [
  { days: 3, points: 10 },
  { days: 7, points: 25 },
  { days: 14, points: 40 },
  { days: 30, points: 75 },
  { days: 60, points: 120 },
  { days: 100, points: 200 },
  { days: 200, points: 300 },
  { days: 365, points: 500 },
];

export type WeekendMission = {
  /** 5 = Friday, 6 = Saturday, 0 = Sunday. */
  day: number;
  title: string;
  points: number;
};

const WEEKEND_MISSIONS: Record<number, WeekendMission> = {
  5: { day: 5, title: "Friday night mission", points: EVENT_POINTS.weekend_mission },
  6: { day: 6, title: "Weekend warrior", points: EVENT_POINTS.weekend_mission },
  0: { day: 0, title: "Sunday prep", points: EVENT_POINTS.weekend_mission },
};

/** The bonus mission for a given day, or null on a weekday. */
export function weekendMissionFor(date = new Date()): WeekendMission | null {
  return WEEKEND_MISSIONS[date.getDay()] ?? null;
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string) {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

function key(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

function emptyDaily(date = todayKey()): GamificationDaily {
  return { date, earned: {}, once: {} };
}

export function emptyGamificationStats(): GamificationStats {
  return {
    points: 0,
    weeklyPoints: 0,
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: null,
    lastChatRewardDate: null,
    correctQuestions: 0,
    failedQuestions: 0,
    roadmapsCompleted: 0,
    streakMilestonesAwarded: [],
    daily: emptyDaily(),
    events: [],
  };
}

/**
 * Bring a blob saved by an older build up to the current shape.
 *
 * The only thing that needs real care is streakMilestonesAwarded. A student who
 * has been on a 40-day streak since before milestones existed must not be paid
 * 150 points of back-dated bonuses the first time they answer a question, so on
 * the first read (the key is absent, not merely empty) every milestone they have
 * already passed is marked as paid. Points, streak and history are carried over
 * untouched — a returning user loses nothing.
 */
function migrate(raw: Partial<GamificationStats>): GamificationStats {
  const stats: GamificationStats = { ...emptyGamificationStats(), ...raw };

  if (!Array.isArray(raw.streakMilestonesAwarded)) {
    stats.streakMilestonesAwarded = STREAK_MILESTONES.filter(
      (milestone) => stats.currentStreak >= milestone.days,
    ).map((milestone) => milestone.days);
  }

  const today = todayKey();
  const daily = raw.daily;
  if (!daily || typeof daily !== "object" || daily.date !== today) {
    stats.daily = emptyDaily(today);
    // Pre-caps builds tracked only the chat reward, so carry that one across:
    // without it a returning student could re-collect today's chat points.
    if (stats.lastChatRewardDate === today) {
      stats.daily.once.chat_entered = true;
      stats.daily.earned.chat_entered = EVENT_POINTS.chat_entered;
    }
  } else {
    stats.daily = { date: today, earned: { ...daily.earned }, once: { ...daily.once } };
  }

  return stats;
}

export function loadGamificationStats(userId: string): GamificationStats {
  if (typeof window === "undefined") return emptyGamificationStats();
  try {
    const raw = window.localStorage.getItem(key(userId));
    return raw ? migrate(JSON.parse(raw) as Partial<GamificationStats>) : emptyGamificationStats();
  } catch {
    return emptyGamificationStats();
  }
}

function saveGamificationStats(userId: string, stats: GamificationStats) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key(userId), JSON.stringify(stats));
  window.dispatchEvent(new CustomEvent("gd:gamification", { detail: stats }));
  // Best-effort push to the shared leaderboard so this user can be ranked
  // against everyone else. Never blocks or throws into the caller.
  void syncLeaderboard(userId, stats);
}

async function syncLeaderboard(userId: string, stats: GamificationStats) {
  if (userId === "guest") return;
  try {
    await supabase
      .from("user_profiles")
      .update({
        points: Math.max(0, Math.round(stats.points)),
        weekly_points: Math.max(0, Math.round(stats.weeklyPoints)),
        current_streak: Math.max(0, Math.round(stats.currentStreak)),
        gamification_updated_at: new Date().toISOString(),
      })
      .eq("id", userId);
  } catch {
    // Leaderboard sync is best-effort; local points still work offline.
  }
}

/** How much of an event's daily allowance is left. Infinity when uncapped. */
export function remainingDailyAllowance(stats: GamificationStats, type: GamificationEvent): number {
  const cap = DAILY_POINT_CAPS[type];
  if (cap == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, cap - (stats.daily.earned[type] ?? 0));
}

/**
 * What a normal day of studying is still worth. Deliberately excludes
 * roadmap_completed: finishing a whole roadmap is not something a student can
 * decide to do this afternoon, and counting it would advertise 300+ points that
 * are not actually on the table.
 */
const DAILY_HEADLINE_EVENTS: GamificationEvent[] = [
  "chat_entered",
  "coach_question_correct",
  "coach_session_completed",
  "coach_timed_challenge",
  "coach_beat_timer",
  "weekend_mission",
];

/** Total points still collectable today from ordinary study. */
export function pointsAvailableToday(stats: GamificationStats): number {
  return DAILY_HEADLINE_EVENTS.reduce((sum, type) => {
    if (type === "weekend_mission" && !weekendMissionFor()) return sum;
    const remaining = remainingDailyAllowance(stats, type);
    return sum + (Number.isFinite(remaining) ? remaining : 0);
  }, 0);
}

function applyPoints(
  stats: GamificationStats,
  type: GamificationEvent,
  requested: number,
  label: string,
) {
  let awarded = requested;
  if (requested > 0) {
    awarded = Math.min(requested, remainingDailyAllowance(stats, type));
    stats.daily.earned[type] = (stats.daily.earned[type] ?? 0) + awarded;
  }
  if (awarded === 0) return 0;

  stats.points = Math.max(0, stats.points + awarded);
  stats.weeklyPoints = Math.max(0, stats.weeklyPoints + awarded);
  stats.events.unshift({
    id: `${Date.now()}-${type}-${stats.events.length}`,
    type,
    points: awarded,
    createdAt: new Date().toISOString(),
    label,
  });
  return awarded;
}

export function recordGamificationEvent(
  userId: string,
  type: GamificationEvent,
  options: { count?: number; oncePerDay?: boolean } = {},
) {
  const count = Math.max(1, options.count ?? 1);
  const today = todayKey();
  const stats = loadGamificationStats(userId);

  // Generic once-per-day gate. `lastChatRewardDate` is still honoured (and
  // still written) so a student mid-upgrade cannot double-collect.
  if (options.oncePerDay) {
    if (stats.daily.once[type]) return stats;
    if (type === "chat_entered" && stats.lastChatRewardDate === today) return stats;
  }

  if (stats.lastActiveDate) {
    const gap = daysBetween(stats.lastActiveDate, today);
    if (gap === 1) {
      stats.currentStreak += 1;
    } else if (gap > 1) {
      stats.currentStreak = 1;
      applyPoints(stats, "streak_broken", EVENT_POINTS.streak_broken, EVENT_LABELS.streak_broken);
    }
  } else {
    stats.currentStreak = 1;
  }

  stats.lastActiveDate = today;
  stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
  if (type === "chat_entered") stats.lastChatRewardDate = today;
  if (options.oncePerDay) stats.daily.once[type] = true;

  applyPoints(
    stats,
    type,
    EVENT_POINTS[type] * count,
    count > 1 ? `${EVENT_LABELS[type]} x${count}` : EVENT_LABELS[type],
  );

  // A streak that just grew may have crossed a milestone. Paid once ever.
  for (const milestone of STREAK_MILESTONES) {
    if (stats.currentStreak < milestone.days) continue;
    if (stats.streakMilestonesAwarded.includes(milestone.days)) continue;
    stats.streakMilestonesAwarded.push(milestone.days);
    applyPoints(stats, "streak_milestone", milestone.points, `${milestone.days}-day streak`);
  }

  if (type === "coach_question_correct") stats.correctQuestions += count;
  if (type === "coach_question_failed") stats.failedQuestions += count;
  if (type === "roadmap_completed") stats.roadmapsCompleted += count;

  stats.events = stats.events.slice(0, 30);

  saveGamificationStats(userId, stats);
  return stats;
}

export function recordRoadmapCompletedOnce(userId: string, roadmapId: string) {
  if (typeof window === "undefined") return emptyGamificationStats();
  const key = `${STORAGE_PREFIX}${userId}:roadmap:${roadmapId}`;
  if (window.localStorage.getItem(key)) return loadGamificationStats(userId);
  window.localStorage.setItem(key, "1");
  return recordGamificationEvent(userId, "roadmap_completed");
}

/**
 * The weekend bonus, paid for actually studying on a Friday/Saturday/Sunday —
 * not for opening the app. Called after a question set is finished. No-ops on a
 * weekday and pays at most once per day.
 */
export function recordWeekendMissionIfDue(userId: string) {
  if (!weekendMissionFor()) return loadGamificationStats(userId);
  return recordGamificationEvent(userId, "weekend_mission", { oncePerDay: true });
}

/** Push the locally-stored stats to the shared leaderboard (e.g. on page open). */
export async function pushGamificationToServer(userId: string) {
  await syncLeaderboard(userId, loadGamificationStats(userId));
}

/**
 * @deprecated Superseded by the named ranks in src/lib/ranks.ts. Kept so any
 * caller that has not been migrated keeps compiling and returning what it used
 * to; nothing user-facing reads it any more.
 */
export function levelFromPoints(points: number) {
  return Math.floor(points / 250) + 1;
}

/** @deprecated See levelFromPoints. Use rankProgress() from src/lib/ranks.ts. */
export function pointsToNextLevel(points: number) {
  return 250 - (points % 250 || 250);
}
