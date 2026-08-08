// The opening streak moment.
//
// The brief called for it "on app open". The hard constraint is that it must
// not block entry, so although it is centred it is not a modal: no focus trap,
// no scroll lock, nothing behind it disabled, and four ways out (Escape, the X,
// the scrim, the auto-dismiss timer). See progression-moment.tsx.
//
// Three gates decide whether it exists at all (see takeStreakOpening in
// src/lib/progression-moments.ts):
//   - a 0-day streak gets nothing; there is no fire to be on
//   - once per device per day, consumed the moment it is granted, so moving
//     between pages cannot replay it
//   - blocked storage counts as "already shown"
//
// On Friday, Saturday and Sunday it carries that day's bonus mission instead of
// the ordinary daily reward. The mission is described as available, not
// granted: the +15 is paid when a question set is actually finished today.
//
// THE MOMENT: the same single gesture as the rank-up. The rank bar runs from
// empty to where the student actually stands (real rankProgress data), and the
// flame lands when it arrives.

import { Flame } from "lucide-react";
import { RankProgressBar } from "@/components/rank-badge";
import { MomentOverlay, useMomentReveal } from "@/components/progression-moment";
import { rankProgress } from "@/lib/ranks";
import type { WeekendMission } from "@/lib/gamification";

const AUTO_DISMISS_MS = 6500;

export function StreakOpening({
  open,
  streak,
  points,
  mission,
  pointsAvailable,
  onDismiss,
}: {
  open: boolean;
  streak: number;
  points: number;
  mission: WeekendMission | null;
  pointsAvailable: number;
  onDismiss: () => void;
}) {
  // Hooks run unconditionally; MomentOverlay does its own early return.
  const { fill, landed } = useMomentReveal(open);

  if (!open) return null;

  // Day one is a start, not a run. Claiming someone is "on fire" for turning up
  // once is the kind of praise that teaches students to ignore the app.
  const headline = streak >= 2 ? "You're on fire." : "Day one. Let's build it.";
  const progress = rankProgress(points);

  return (
    <MomentOverlay
      open
      labelledBy="gd-streak-title"
      autoDismissMs={AUTO_DISMISS_MS}
      onDismiss={onDismiss}
    >
      <div className="flex justify-center">
        <span
          className={`grid h-14 w-14 place-items-center rounded-2xl border border-pop/30 bg-pop/10 text-pop ${landed ? "gd-moment-badge" : ""}`}
        >
          <Flame className="h-7 w-7" />
        </span>
      </div>

      <div className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-pop tabular-nums">
        {streak} day{streak === 1 ? "" : "s"} in a row
      </div>
      <h2
        id="gd-streak-title"
        className="mt-0.5 text-lg font-semibold tracking-[-0.02em] text-foreground"
      >
        {headline}
      </h2>

      {mission ? (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide text-foreground">
            {mission.title}
          </span>{" "}
          — finish a question set today for a bonus{" "}
          <span className="font-semibold text-pop tabular-nums">+{mission.points}</span>.
        </p>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-pop tabular-nums">
            {pointsAvailable.toLocaleString()}
          </span>{" "}
          points are on the table today.
        </p>
      )}

      <RankProgressBar percent={fill ? progress.percent : 0} className="mt-4" />

      {/* Height reserved so the card does not jump when this lands. */}
      <div className="mt-2 min-h-[1.25rem]">
        {landed && (
          <div className="gd-moment-resolve truncate text-[11px] text-muted-foreground tabular-nums">
            {progress.next
              ? `${progress.rank.name} — ${progress.pointsToNext.toLocaleString()} pts to ${progress.next.name}`
              : `${progress.rank.name} — top rank reached`}
          </div>
        )}
      </div>
    </MomentOverlay>
  );
}
