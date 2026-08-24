// The rank-up moment.
//
// Three rules, in priority order:
//   1. It must never stand between a student and their work. It is centred now,
//      but it is still not a modal: no focus steal, no scroll lock, no
//      aria-modal, nothing behind it disabled. See progression-moment.tsx.
//   2. It must be skippable. Escape, the X, the scrim and the button all
//      dismiss it, and it retires itself after a few seconds on its own.
//   3. It must respect prefers-reduced-motion — in which case the card appears
//      already resolved: full bar, new badge, new name, no movement.
//
// It fires at most once per rank per device — see takeRankCelebration() in
// src/lib/progression-moments.ts, which is what decides whether this mounts.
//
// THE MOMENT: the bar belongs to the rank they were in, and it runs to full.
// When it tops out, the badge and the name flip to the rank they just earned.
// One gesture — you watch a bar complete and it turns into your promotion —
// rather than several effects competing for the same second.

import { Sparkles } from "lucide-react";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { MomentOverlay, useMomentReveal } from "@/components/progression-moment";
import { RANKS, rankProgress, uploadBonusGain, type AcademicRank } from "@/lib/ranks";
import { allowanceFrom } from "@/lib/allowances";

/** Long enough to watch the bar land and read two short lines. */
const AUTO_DISMISS_MS = 7000;

export function RankUpCelebration({
  rank,
  points,
  activeDays,
  onDismiss,
}: {
  rank: AcademicRank | null;
  points: number;
  /** Needed alongside `rank` because the daily-upload total this reports now
   *  has two independent inputs (see allowances.ts) - the rank alone is not
   *  enough to say what the new number is. */
  activeDays: number;
  onDismiss: () => void;
}) {
  // Hooks run unconditionally; MomentOverlay does its own early return.
  const { fill, landed } = useMomentReveal(rank != null);

  if (!rank) return null;

  // The rank they came from. takeRankCelebration only ever hands back a rank
  // the student has moved UP into, so there is always one below — but index 0
  // falls back to itself rather than crashing if that ever stops being true.
  const index = RANKS.findIndex((r) => r.id === rank.id);
  const previous = index > 0 ? RANKS[index - 1] : rank;
  const shown = landed ? rank : previous;
  // Real progress inside the rank they just entered, for the footer line.
  const progress = rankProgress(points);

  return (
    <MomentOverlay
      open
      labelledBy="gd-rankup-title"
      autoDismissMs={AUTO_DISMISS_MS}
      onDismiss={onDismiss}
    >
      <div className="flex items-center justify-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-pop">
        <Sparkles className="h-3.5 w-3.5" />
        Rank up
      </div>

      <div className="mt-3 flex justify-center">
        {/* Keyed on the rank so React remounts the span at the swap and the pop
            animation actually restarts rather than being skipped. */}
        <span key={shown.id} className={landed ? "gd-moment-badge" : undefined}>
          <RankBadge rank={shown} size="lg" />
        </span>
      </div>

      <h2
        id="gd-rankup-title"
        className={`mt-3 text-lg font-semibold tracking-[-0.02em] ${landed ? "gd-moment-resolve text-foreground" : "text-muted-foreground"}`}
      >
        {shown.name}
      </h2>

      <RankProgressBar percent={fill ? 100 : 0} className="mt-4" />

      {/* Height is reserved so the card does not jump when the copy lands. */}
      <div className="mt-3 min-h-[3.25rem]">
        {landed && (
          <p className="gd-moment-resolve text-[13px] leading-relaxed text-muted-foreground">
            {/* Only claim an upload gain when this rank actually raises the
                number. Several ranks share a bonus, and "+10 uploads a day" on
                a rank that changed nothing is a promise the Library breaks. */}
            {uploadBonusGain(rank) > 0
              ? `${rank.threshold.toLocaleString()} points. Your daily uploads go up to ${allowanceFrom(points, 0, activeDays).total}.`
              : progress.next
                ? `${rank.threshold.toLocaleString()} points. ${progress.pointsToNext.toLocaleString()} more to ${progress.next.name}.`
                : `${rank.threshold.toLocaleString()} points. Top rank reached.`}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-1 inline-flex items-center justify-center rounded-lg bg-pop px-4 py-2 text-[12px] font-semibold text-pop-foreground transition-opacity hover:opacity-90"
      >
        Back to it
      </button>
    </MomentOverlay>
  );
}
