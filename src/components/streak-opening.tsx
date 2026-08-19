// The opening streak moment — a four-second strip on the new-chat page.
//
// It used to be a centred half-page card mounted from the app shell. The owner
// killed that: the new-chat screen is the cleanest surface in the product and
// standing a card in front of it to say "well done for arriving" was the exact
// opposite of clean. So the moment is now inline, slim, and temporary. It sits
// where the greeting sits, animates once, and then removes itself, leaving the
// blank chat with nothing on it but the greeting and the composer.
//
// WHAT IT MUST NEVER DO. There is no overlay, no scrim, no focus trap, no
// scroll lock and no auto-focus anywhere in this file. It is a `role="status"`
// strip in normal flow. The composer beneath it is fully usable while it runs,
// and the first keystroke retires it early (the chat page calls `dismiss()`
// from the textarea's onChange), because a student who has started typing has
// told us what they came for.
//
// SELF-GATING. The shell no longer mounts this, so the gates live here in
// `useStreakOpening`, which calls takeStreakOpening() from
// src/lib/progression-moments.ts:
//   - a 0-day streak gets nothing; there is no fire to be on
//   - once per device per day, consumed the moment it is granted, so moving
//     between pages cannot replay it
//   - blocked storage counts as "already shown"
// The streak is read from localStorage and then grows again when the day's
// chat_entered award lands, so the offer is deliberately made off a real
// (>= 1) streak rather than off the empty stats the page starts with, and a
// short delay lets the page paint first.
//
// WHAT THE BAR MEASURES, AND WHY IT IS NOT RANK. The first cut of this drove
// the bar from rankProgress(points). That was honest and useless: rank
// thresholds are thousands of points, so a real student watched a 2% sliver
// crawl and learned they were nowhere. This bar measures the run to the next
// STREAK milestone — the bonuses in STREAK_MILESTONES that the app genuinely
// pays — so it is days out of days, the worst case is day one at 1/3, and the
// usual case is somewhere between half and nearly full. Momentum reads as
// momentum without anybody being lied to, and the fraction is printed next to
// the bar so the number backing the sweep is on screen.
//
// THE LINE UNDERNEATH has to be true. Every branch of it is read from data the
// app already holds — a milestone bonus in today's event ledger, the weekend
// mission, points banked today under the daily caps, points still collectable
// today. Nothing here awards anything; it only reports what was awarded.

import { useCallback, useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { useMomentReveal } from "@/components/progression-moment";
import { takeStreakOpening } from "@/lib/progression-moments";
import {
  STREAK_MILESTONES,
  pointsAvailableToday,
  weekendMissionFor,
  type GamificationStats,
} from "@/lib/gamification";

/** Let the chat page paint, and let the day's chat_entered award settle first. */
const SHOW_DELAY_MS = 400;
/** On screen. The owner asked for five seconds, so this is sized to make the
 *  WHOLE moment five: SHOW_DELAY_MS + HOLD_MS + EXIT_MS = 5000. The bar fill
 *  (700ms) and its landing sit inside the hold. */
const HOLD_MS = 4100;
/** Fade and collapse. Long enough that the greeting group glides back to
 *  centre rather than jumping when the strip leaves. */
const EXIT_MS = 500;

type Phase = "waiting" | "arming" | "in" | "out" | "done";

export type StreakMoment = {
  /** Render the strip. Stays true through the exit so it can fade, not vanish. */
  visible: boolean;
  /** The strip is on its way out. */
  leaving: boolean;
  /** Retire it early — wired to the first keystroke in the composer. */
  dismiss: () => void;
};

/**
 * Owns whether the moment runs, and its whole timeline.
 *
 * `enabled` is the caller's context gate (a blank chat, a signed-in student).
 * It is checked before the day is consumed so landing straight into an existing
 * conversation cannot burn today's moment without showing it.
 */
export function useStreakOpening(streak: number, enabled: boolean): StreakMoment {
  const [phase, setPhase] = useState<Phase>("waiting");
  // The offer is made at most once per mount. Without this the streak growing
  // mid-session (the chat_entered award) would re-run the gate.
  const offered = useRef(false);

  useEffect(() => {
    if (!enabled || offered.current) return;
    // Not `offered` yet: the page's first render has empty stats, and refusing
    // a 0-day streak there must not spend the one offer this mount gets.
    if (streak < 1) return;
    offered.current = true;
    setPhase(takeStreakOpening(streak) ? "arming" : "done");
  }, [enabled, streak]);

  // One timer, driven by the phase, so a re-render caused by the streak
  // changing underneath the animation cannot cancel the pending step.
  useEffect(() => {
    if (phase === "waiting" || phase === "done") return;
    const next: Phase = phase === "arming" ? "in" : phase === "in" ? "out" : "done";
    const ms = phase === "arming" ? SHOW_DELAY_MS : phase === "in" ? HOLD_MS : EXIT_MS;
    const timer = window.setTimeout(() => setPhase(next), ms);
    return () => window.clearTimeout(timer);
  }, [phase]);

  const dismiss = useCallback(() => {
    // Typing before it appears cancels it outright; typing while it is up sends
    // it out through its normal exit so nothing snaps.
    setPhase((current) => (current === "in" ? "out" : current === "arming" ? "done" : current));
  }, []);

  return { visible: phase === "in" || phase === "out", leaving: phase === "out", dismiss };
}

type StreakArc = {
  /** 0-100, what the bar fills to. */
  percent: number;
  /** The fraction behind the sweep, printed beside the bar. */
  measure: string;
  /** The single true line underneath. */
  reward: string;
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The bar's target, its label and its payoff line, all read from real stats.
 *
 * A milestone banked TODAY is the strongest thing we can say, and it is checked
 * against the event ledger rather than `streakMilestonesAwarded`: that array is
 * back-filled on first load for students whose streak predates milestones, so
 * it would have us congratulate people on bonuses they were never paid.
 */
function streakArc(stats: GamificationStats): StreakArc {
  const streak = Math.max(1, stats.currentStreak);
  const next = STREAK_MILESTONES.find((milestone) => milestone.days > streak) ?? null;
  const today = todayKey();
  const bankedMilestone = stats.events.find(
    (event) => event.type === "streak_milestone" && event.createdAt.slice(0, 10) === today,
  );
  const bankedToday = Object.values(stats.daily.earned).reduce(
    (sum, points) => sum + (points ?? 0),
    0,
  );
  const onTheTable = pointsAvailableToday(stats);
  const mission = weekendMissionFor();

  // A milestone day tops the bar out, because that is literally what happened.
  const percent = bankedMilestone || !next ? 100 : Math.round((streak / next.days) * 100);
  const measure = bankedMilestone
    ? "milestone reached"
    : next
      ? `${streak}/${next.days} days`
      : "every milestone cleared";

  const reward = bankedMilestone
    ? `${bankedMilestone.label} — +${bankedMilestone.points} banked.`
    : next && next.days - streak === 1
      ? `One more day and the ${next.days}-day bonus pays +${next.points}.`
      : mission
        ? `${mission.title} is live — finish a question set for +${mission.points}.`
        : bankedToday > 0
          ? `+${bankedToday} banked today, ${onTheTable.toLocaleString()} still on the table.`
          : `${onTheTable.toLocaleString()} points on the table today.`;

  return { percent, measure, reward };
}

export function StreakOpening({ stats, leaving }: { stats: GamificationStats; leaving: boolean }) {
  // Hooks first; the guard below is a safety net, not the gate (that is
  // useStreakOpening) — a strip reading "0 days in a row" would be a bug.
  const { fill, landed } = useMomentReveal(true);
  const arc = streakArc(stats);

  if (stats.currentStreak < 1) return null;

  const pct = fill ? arc.percent : 0;
  // The flame rides the head of the fill. Clamped so it never hangs off either
  // end of the track — it is a 24px disc sitting on a 6px bar.
  const markerLeft = Math.min(94, Math.max(6, pct));

  return (
    <div
      role="status"
      aria-live="polite"
      // overflow-hidden + max-height is what makes the exit a collapse rather
      // than a disappearance: the greeting and composer glide back to centre.
      // The bar's margins are wide enough that the flame disc is never clipped.
      className={`mx-auto w-full max-w-md overflow-hidden transition-all duration-500 ease-out motion-reduce:transition-none ${
        leaving ? "mb-0 max-h-0 opacity-0" : "mb-6 max-h-28 opacity-100 sm:mb-8"
      }`}
    >
      <div className="flex items-baseline gap-2">
        {/* The hero. The bar is the gesture; this number is the point of it. */}
        <span
          className={`text-2xl font-semibold leading-none tracking-[-0.02em] text-pop tabular-nums ${
            landed ? "gd-moment-badge" : "opacity-0"
          }`}
        >
          {stats.currentStreak}
        </span>
        <span className="text-[13px] font-medium text-foreground">
          day{stats.currentStreak === 1 ? "" : "s"} in a row
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {arc.measure}
        </span>
      </div>

      <div className="relative mt-3.5 h-1.5 rounded-full bg-foreground/[0.08]">
        <div
          className="h-full rounded-full bg-pop transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
        <span
          aria-hidden="true"
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-700 ease-out motion-reduce:transition-none"
          style={{ left: `${markerLeft}%` }}
        >
          {/* Outer span owns the positioning transform, inner span owns the
              landing animation, so the two never fight over `transform`. */}
          <span
            className={`grid h-6 w-6 place-items-center rounded-full border border-pop/40 bg-background text-pop shadow-sm ${
              landed ? "gd-moment-badge" : ""
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
          </span>
        </span>
      </div>

      <p
        className={`mt-3.5 text-center text-[12px] leading-snug text-muted-foreground ${
          landed ? "gd-moment-resolve" : "opacity-0"
        }`}
      >
        {arc.reward}
      </p>
    </div>
  );
}
