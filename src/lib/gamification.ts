import { supabase } from "@/integrations/supabase/client";

export type GamificationEvent =
  | "chat_entered"
  | "coach_question_correct"
  | "coach_question_failed"
  | "coach_session_completed"
  | "roadmap_completed"
  | "streak_broken";

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
  events: Array<{
    id: string;
    type: GamificationEvent;
    points: number;
    createdAt: string;
    label: string;
  }>;
};

const STORAGE_PREFIX = "gd:gamification:";

const EVENT_POINTS: Record<GamificationEvent, number> = {
  chat_entered: 2,
  coach_question_correct: 10,
  coach_question_failed: -2,
  coach_session_completed: 15,
  roadmap_completed: 100,
  streak_broken: -5,
};

const EVENT_LABELS: Record<GamificationEvent, string> = {
  chat_entered: "Entered chat",
  coach_question_correct: "Correct My Coach answer",
  coach_question_failed: "Missed My Coach question",
  coach_session_completed: "Completed My Coach session",
  roadmap_completed: "Completed roadmap",
  streak_broken: "Streak break",
};

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
    events: [],
  };
}

export function loadGamificationStats(userId: string): GamificationStats {
  if (typeof window === "undefined") return emptyGamificationStats();
  try {
    const raw = window.localStorage.getItem(key(userId));
    return raw ? { ...emptyGamificationStats(), ...JSON.parse(raw) } : emptyGamificationStats();
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

export function recordGamificationEvent(
  userId: string,
  type: GamificationEvent,
  options: { count?: number; oncePerDay?: boolean } = {},
) {
  const count = Math.max(1, options.count ?? 1);
  const today = todayKey();
  const stats = loadGamificationStats(userId);

  if (type === "chat_entered" && options.oncePerDay && stats.lastChatRewardDate === today) {
    return stats;
  }

  if (stats.lastActiveDate) {
    const gap = daysBetween(stats.lastActiveDate, today);
    if (gap === 1) {
      stats.currentStreak += 1;
    } else if (gap > 1) {
      stats.currentStreak = 1;
      stats.points = Math.max(0, stats.points + EVENT_POINTS.streak_broken);
      stats.weeklyPoints = Math.max(0, stats.weeklyPoints + EVENT_POINTS.streak_broken);
      stats.events.unshift({
        id: `${Date.now()}-streak`,
        type: "streak_broken",
        points: EVENT_POINTS.streak_broken,
        createdAt: new Date().toISOString(),
        label: EVENT_LABELS.streak_broken,
      });
    }
  } else {
    stats.currentStreak = 1;
  }

  stats.lastActiveDate = today;
  stats.longestStreak = Math.max(stats.longestStreak, stats.currentStreak);
  if (type === "chat_entered") stats.lastChatRewardDate = today;

  const points = EVENT_POINTS[type] * count;
  stats.points = Math.max(0, stats.points + points);
  stats.weeklyPoints = Math.max(0, stats.weeklyPoints + points);

  if (type === "coach_question_correct") stats.correctQuestions += count;
  if (type === "coach_question_failed") stats.failedQuestions += count;
  if (type === "roadmap_completed") stats.roadmapsCompleted += count;

  stats.events.unshift({
    id: `${Date.now()}-${type}`,
    type,
    points,
    createdAt: new Date().toISOString(),
    label: count > 1 ? `${EVENT_LABELS[type]} x${count}` : EVENT_LABELS[type],
  });
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

/** Push the locally-stored stats to the shared leaderboard (e.g. on page open). */
export async function pushGamificationToServer(userId: string) {
  await syncLeaderboard(userId, loadGamificationStats(userId));
}

export function levelFromPoints(points: number) {
  return Math.floor(points / 250) + 1;
}

export function pointsToNextLevel(points: number) {
  return 250 - (points % 250 || 250);
}
