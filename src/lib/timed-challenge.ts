// The optional "race the clock" timer on a PQ question set.
//
// Genuinely optional, and the default is off. An untimed set behaves exactly as
// it did before this existed: no timer key is written into the session, the
// session view finds nothing, and no clock is rendered or scored. That is the
// whole compatibility story — a set created by an older build simply has no
// `timer_seconds` in its feedback JSONB, which reads as "untimed".
//
// Running out of time does NOT submit for the student. Snatching a half-finished
// set away and grading it would turn an opt-in game into a punishment, and the
// student who most needs the practice is the one most likely to be slow. The
// clock expiring costs the +5 and nothing else; the set stays open.

/** Used to suggest a duration from the size of the set. */
export const DEFAULT_TIMER_SECONDS_PER_QUESTION = 45;

/**
 * The bounds on a student-typed time, in MINUTES. Minutes are the unit the
 * student types; seconds stay the only thing ever stored.
 *
 * The ceiling is 4 hours. The largest set the app can build is 60 MCQ + 60
 * essays (both the config screen and the edge function cap each kind at 60),
 * and the most generous preset for 120 questions is about 135 minutes — so a
 * lower ceiling would refuse a legitimate "generous" custom time on the biggest
 * possible set. 240 clears that with room, and it is past any single real exam
 * sitting, so anything above it is a typo or a joke rather than a study plan.
 * The countdown is also rebuilt from the wall clock each time the set is
 * opened, so a budget that outlives a sitting is not something we can honour
 * anyway.
 */
export const MIN_TIMER_MINUTES = 1;
export const MAX_TIMER_MINUTES = 240;

export type TimerMinutesResult = { ok: true; seconds: number } | { ok: false; error: string };

/**
 * Turn what the student typed into the seconds everything else already speaks.
 *
 * Deliberately not a clamp. Silently turning "600" into 240 hands back a timer
 * the student did not ask for and cannot see the reason for; saying "1 to 240
 * minutes" tells them what the rule is and lets them choose again.
 */
export function parseTimerMinutes(raw: string): TimerMinutesResult {
  const text = raw.trim();
  if (!text) return { ok: false, error: "Type how many minutes you want." };

  const minutes = Number(text);
  if (!Number.isFinite(minutes)) {
    return { ok: false, error: "Minutes only — type a number like 25." };
  }
  if (minutes <= 0) {
    return { ok: false, error: `A time has to be at least ${MIN_TIMER_MINUTES} minute.` };
  }
  if (minutes < MIN_TIMER_MINUTES) {
    return { ok: false, error: `The shortest time is ${MIN_TIMER_MINUTES} minute.` };
  }
  if (minutes > MAX_TIMER_MINUTES) {
    return {
      ok: false,
      error: `The longest time is ${MAX_TIMER_MINUTES} minutes (4 hours).`,
    };
  }
  // Half minutes are fine — 2.5 becomes 150s — but the stored unit never changes.
  return { ok: true, seconds: Math.round(minutes * 60) };
}

export type TimedChallenge = {
  /** The budget the student accepted, in seconds. */
  seconds: number;
};

/** The timer stored on a session's feedback JSONB, or null when untimed. */
export function readTimedChallenge(feedback: unknown): TimedChallenge | null {
  if (!feedback || typeof feedback !== "object") return null;
  const raw = (feedback as { timer_seconds?: unknown }).timer_seconds;
  const seconds = typeof raw === "number" ? Math.round(raw) : 0;
  return seconds > 0 ? { seconds } : null;
}

/**
 * The three offered durations for a set of `count` questions: tight, the
 * suggested pace, and generous. Rounded to whole minutes because a countdown
 * reading "7:23 left" is a stopwatch, and this is meant to feel like an exam.
 */
export function timerPresetSeconds(count: number): number[] {
  const suggested = Math.max(1, Math.round((count * DEFAULT_TIMER_SECONDS_PER_QUESTION) / 60));
  const presets = [
    Math.max(1, Math.round(suggested * 0.7)),
    suggested,
    Math.round(suggested * 1.5),
  ];
  // De-duplicate: for very small sets the three can collapse onto each other.
  return [...new Set(presets)].map((minutes) => minutes * 60);
}

/**
 * The most generous budget for a set of `count` questions that still earns the
 * +5 "Beat the clock" bonus.
 *
 * Why this exists: the bonus is paid for finishing INSIDE the budget, and once
 * the student can type their own budget, "beat the clock" is free money — set
 * 240 minutes on a 5-question set and you win every time. This caps the
 * *bonus-eligible* budget at the most generous preset, which is exactly the
 * longest time the app was already willing to call a race.
 *
 * It changes nothing for a student who takes a preset: all three presets are at
 * or below this line by construction. It only bites on a custom time longer
 * than the app's own "generous" suggestion, and the picker says so on screen
 * before the set is built — the set still runs, and the +10 for opting into a
 * timed sitting is still paid. Only the speed bonus is withheld.
 */
export function speedBonusMaxSeconds(count: number): number {
  const presets = timerPresetSeconds(Math.max(1, count));
  return presets[presets.length - 1] ?? 0;
}

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
