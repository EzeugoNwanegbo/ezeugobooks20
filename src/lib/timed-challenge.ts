// The optional "race the clock" timer on a My Coach question set.
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

export function formatClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}
