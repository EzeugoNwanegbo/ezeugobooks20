// The rank badge and its progress bar.
//
// Tiers are expressed as fill weight, not hue. The app has exactly one accent
// (Faded Copper, --pop) and in the light and brutal skins --pop and --leaf
// resolve to the same value, so a bronze/silver/gold scheme would read as four
// identical badges on half the themes. Outline → tint → strong tint → solid
// reads as a ladder in all four skins and under both data-discipline palettes,
// and it introduces no new colour.

import {
  Award,
  ChevronsUp,
  ChevronUp,
  Compass,
  Crown,
  Gem,
  Medal,
  Shield,
  ShieldCheck,
  Star,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import {
  RANKS,
  rankIndexFromPoints,
  rankProgress,
  type AcademicRank,
  type RankTier,
} from "@/lib/ranks";

const RANK_ICONS: Record<string, LucideIcon> = {
  recruit: Shield,
  cadet: ShieldCheck,
  scout: Compass,
  corporal: ChevronUp,
  sergeant: ChevronsUp,
  lieutenant: Star,
  captain: Award,
  major: Medal,
  colonel: Gem,
  commander: Crown,
  general: Trophy,
};

const TIER_CLASS: Record<RankTier, string> = {
  0: "border-border bg-foreground/[0.04] text-muted-foreground",
  1: "border-pop/30 bg-pop/10 text-pop",
  2: "border-pop/50 bg-pop/20 text-pop",
  3: "border-pop bg-pop text-pop-foreground",
};

const SIZE_CLASS = {
  sm: "h-6 w-6 rounded-md",
  md: "h-9 w-9 rounded-lg",
  lg: "h-16 w-16 rounded-2xl",
} as const;

const ICON_CLASS = {
  sm: "h-3.5 w-3.5",
  md: "h-4.5 w-4.5",
  lg: "h-8 w-8",
} as const;

export function RankBadge({
  rank,
  size = "md",
  className = "",
}: {
  rank: AcademicRank;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  const Icon = RANK_ICONS[rank.id] ?? Shield;
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center border transition-colors ${SIZE_CLASS[size]} ${TIER_CLASS[rank.tier]} ${className}`}
    >
      <Icon className={ICON_CLASS[size]} strokeWidth={2} />
    </span>
  );
}

/** The thin bar used everywhere a rank is shown with its progress. */
export function RankProgressBar({
  percent,
  className = "",
}: {
  percent: number;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div
      className={`h-1.5 overflow-hidden rounded-full bg-foreground/[0.08] ${className}`}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Progress to next rank"
    >
      <div
        className="h-full rounded-full bg-pop transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * The whole-journey bar: Academic Recruit to Academic General on one track,
 * with a tick at every rank boundary, rather than a bar that empties back to
 * zero at each promotion.
 *
 * NOT drawn to scale. RANKS' thresholds are 0, 50, 250, 500, 1,000 ...
 * 15,000 - plotted honestly, the first three ranks would sit inside the
 * leftmost 1.7% of the track, which is invisible at any width this app
 * renders at. So the eleven ranks instead get ten EQUAL segments, and
 * position within a segment is linear in that segment's own point range:
 *
 *   position = (rankIndex + earnedInBand / bandSize) / (RANKS.length - 1)
 *
 * earnedInBand and bandSize come straight from rankProgress() rather than
 * being re-derived from the thresholds here, so this can never disagree with
 * RankProgressBar about how far through the current rank a student is - it
 * only disagrees about what the rest of the bar is allowed to show.
 */
export function RankLadderBar({ points, className = "" }: { points: number; className?: string }) {
  const progress = rankProgress(points);
  const index = rankIndexFromPoints(points);
  const bandCount = RANKS.length - 1;
  // No `next` rank means the top of the ladder: hold the fill at the last
  // tick rather than dividing by the bandSize of zero rankProgress() reports
  // there.
  const withinBand = progress.next ? progress.earnedInRank / progress.bandSize : 0;
  const pct = Math.max(0, Math.min(100, ((index + withinBand) / bandCount) * 100));

  return (
    <div className={`relative ${className}`}>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.08]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${progress.rank.name} progress`}
      >
        <div
          className="h-full rounded-full bg-pop transition-[width] duration-700 ease-out motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Ticks are purely decorative milestones on top of the same track - the
          bar underneath already carries the progress value and the label, so
          these are hidden from assistive tech rather than announced as ten
          more progressbars. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {Array.from({ length: bandCount }, (_, i) => i + 1).map((k) => {
          const state = k <= index ? "filled" : k === index + 1 ? "next" : "rest";
          return (
            <span
              key={k}
              style={{ left: `${(k / bandCount) * 100}%` }}
              className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                state === "filled"
                  ? "border-pop bg-pop"
                  : state === "next"
                    ? "border-pop bg-transparent"
                    : "border-transparent bg-foreground/[0.15]"
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

/**
 * Badge + rank name + progress bar. The one block reused by the leaderboard and
 * the settings page so the rank reads identically wherever it appears.
 */
export function RankSummary({ points, className = "" }: { points: number; className?: string }) {
  const progress = rankProgress(points);
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`}>
      <RankBadge rank={progress.rank} size="md" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">
          {progress.rank.name}
        </div>
        <RankLadderBar points={points} className="mt-1.5" />
        <div className="mt-1 truncate text-[11px] text-muted-foreground tabular-nums">
          {progress.next
            ? `${progress.pointsToNext.toLocaleString()} pts to ${progress.next.name}`
            : "Top rank reached"}
        </div>
      </div>
    </div>
  );
}
