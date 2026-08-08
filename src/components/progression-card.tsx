// The progression strip on the blank chat screen.
//
// The study product is the hero. This sits above the greeting in the centred
// greeting + composer group, so every pixel it takes is a pixel of breathing
// room that group loses — which is why it is one row, not a card: badge, rank,
// a thin progress bar, streak, and what today is still worth. On a phone the
// bar and the "to next rank" line drop out and the row keeps its two facts.
//
// It renders nothing at all for a student with no points and no streak: a
// progress bar at 0% next to "Academic Recruit" is not a welcome, it is a
// scoreboard telling someone they have not started.

import { Link } from "@tanstack/react-router";
import { Flame } from "lucide-react";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { rankProgress } from "@/lib/ranks";
import { pointsAvailableToday, type GamificationStats } from "@/lib/gamification";

export function ProgressionCard({ stats }: { stats: GamificationStats }) {
  if (stats.points <= 0 && stats.currentStreak <= 0) return null;

  const progress = rankProgress(stats.points);
  const available = pointsAvailableToday(stats);

  return (
    <Link
      to="/app/leaderboard"
      aria-label={`${progress.rank.name}, ${stats.points} points, ${stats.currentStreak} day streak`}
      className="mx-auto mb-4 flex w-full max-w-md items-center gap-2.5 rounded-xl border border-border/70 bg-surface/70 px-3 py-2 transition-colors hover:border-pop/40 hover:bg-surface sm:mb-5 sm:gap-3"
    >
      <RankBadge rank={progress.rank} size="sm" />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] font-semibold tracking-[-0.01em] text-foreground">
            {progress.rank.name}
          </span>
          <span className="hidden shrink-0 text-[11px] text-muted-foreground tabular-nums sm:inline">
            {progress.next ? `${progress.pointsToNext.toLocaleString()} to go` : "top rank"}
          </span>
        </span>
        <RankProgressBar percent={progress.percent} className="mt-1 h-1" />
      </span>

      {stats.currentStreak > 0 && (
        <span className="flex shrink-0 items-center gap-1 text-[12px] font-semibold text-pop tabular-nums">
          <Flame className="h-3.5 w-3.5" />
          {stats.currentStreak}d
        </span>
      )}

      <span className="hidden shrink-0 border-l border-border/70 pl-2.5 text-[11px] text-muted-foreground tabular-nums sm:inline">
        <span className="font-semibold text-foreground">{available.toLocaleString()}</span> pts
        today
      </span>
    </Link>
  );
}
