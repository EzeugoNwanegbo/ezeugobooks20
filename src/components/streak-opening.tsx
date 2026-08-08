// The opening streak moment.
//
// The brief called for it "on app open". The hard constraint is that it must
// not block entry, so it is not a dialog and it is not on the critical path:
// the app renders, and this arrives beside it. Three gates decide whether it
// exists at all (see takeStreakOpening in src/lib/progression-moments.ts):
//   - a 0-day streak gets nothing; there is no fire to be on
//   - once per device per day, consumed the moment it is granted, so moving
//     between pages cannot replay it
//   - blocked storage counts as "already shown"
//
// On Friday, Saturday and Sunday it carries that day's bonus mission instead of
// the ordinary daily reward. The mission is described as available, not
// granted: the +15 is paid when a question set is actually finished today.

import { useEffect } from "react";
import { Flame, X } from "lucide-react";
import type { WeekendMission } from "@/lib/gamification";

const AUTO_DISMISS_MS = 5500;

export function StreakOpening({
  open,
  streak,
  mission,
  pointsAvailable,
  onDismiss,
}: {
  open: boolean;
  streak: number;
  mission: WeekendMission | null;
  pointsAvailable: number;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(onDismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [open, onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDismiss]);

  if (!open) return null;

  // Day one is a start, not a run. Claiming someone is "on fire" for turning up
  // once is the kind of praise that teaches students to ignore the app.
  const headline = streak >= 2 ? "You're on fire." : "Day one. Let's build it.";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-labelledby="gd-streak-title"
      className="gd-streak-open fixed left-1/2 top-[calc(3.5rem+env(safe-area-inset-top))] z-[119] w-[min(21rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-border/70 bg-surface p-4 shadow-[0_18px_50px_rgba(0,0,0,0.28)] sm:bottom-4 sm:left-auto sm:right-4 sm:top-auto sm:translate-x-0"
    >
      <div className="flex items-start gap-3">
        <span className="gd-streak-flame grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-pop/30 bg-pop/10 text-pop">
          <Flame className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-pop tabular-nums">
            {streak} day{streak === 1 ? "" : "s"} in a row
          </div>
          <h2
            id="gd-streak-title"
            className="mt-0.5 text-base font-semibold tracking-[-0.02em] text-foreground"
          >
            {headline}
          </h2>
          {mission ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-semibold uppercase tracking-wide text-foreground">
                {mission.title}
              </span>{" "}
              — finish a question set today for a bonus{" "}
              <span className="font-semibold text-pop tabular-nums">+{mission.points}</span>.
            </p>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              <span className="font-semibold text-pop tabular-nums">
                {pointsAvailable.toLocaleString()}
              </span>{" "}
              points are on the table today.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-mr-1 -mt-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
