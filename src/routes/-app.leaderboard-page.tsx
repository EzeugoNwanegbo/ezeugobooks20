import { Flame, Medal, Sparkles, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { rankFromPoints, rankProgress } from "@/lib/ranks";
import {
  emptyGamificationStats,
  loadGamificationStats,
  pointsAvailableToday,
  pushGamificationToServer,
  type GamificationStats,
} from "@/lib/gamification";
import { reconcileServerPoints } from "@/lib/points-ledger";

type LeaderboardRow = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  rank: number;
};

export function LeaderboardPage() {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<GamificationStats>(() =>
    user ? loadGamificationStats(user.id) : emptyGamificationStats(),
  );
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [myRank, setMyRank] = useState<{ rank: number; total: number } | null>(null);
  const [boardState, setBoardState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    if (!user) return;
    setStats(loadGamificationStats(user.id));
    const onChange = () => setStats(loadGamificationStats(user.id));
    window.addEventListener("gd:gamification", onChange);
    return () => window.removeEventListener("gd:gamification", onChange);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setBoardState("loading");
      // Order matters. Reconcile first so anything the server awarded (today,
      // only a challenge win) is folded into the local cache, THEN push - so
      // the total that lands on the leaderboard includes it rather than
      // overwriting it with a browser total that never knew about it. A no-op
      // until the ledger migration is applied.
      await reconcileServerPoints(user.id);
      await pushGamificationToServer(user.id);
      const [top, rank] = await Promise.all([
        supabase.rpc("leaderboard_top", { limit_count: 50 }),
        supabase.rpc("leaderboard_rank"),
      ]);
      if (!active) return;
      if (top.error || rank.error) {
        setBoardState("unavailable");
        return;
      }
      setBoard((top.data as LeaderboardRow[]) ?? []);
      setMyRank((rank.data as { rank: number; total: number }[])?.[0] ?? null);
      setBoardState("ready");
    })();
    return () => {
      active = false;
    };
  }, [user, stats.points]);

  const progress = rankProgress(stats.points);
  const ranked = stats.points > 0 && myRank != null;
  const podium = useMemo(() => board.slice(0, 3), [board]);

  const rankValue = useMemo<ReactNode>(() => {
    if (boardState === "loading") return "…";
    if (boardState === "unavailable") return "—";
    if (!ranked || !myRank) return "Unranked";
    return `#${myRank.rank}`;
  }, [boardState, ranked, myRank]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <PageHeader
          eyebrow="Leaderboard"
          title="Where you stand"
          subtitle="Points for showing up, answering My Coach questions, and finishing roadmaps — ranked against every other student."
        />

        {/* The student's own rank, ahead of the standings: where you are on the
            ladder is the thing you came to check, and it is the one number the
            board itself cannot show you. */}
        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-3">
            <RankBadge rank={progress.rank} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-pop">
                Your rank
              </div>
              <div className="truncate font-display text-2xl font-light tracking-[-0.02em]">
                {progress.rank.name}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-2xl font-light tabular-nums">
                {stats.points.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">points</div>
            </div>
          </div>
          <RankProgressBar percent={progress.percent} className="mt-4" />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {progress.next
                ? `${progress.pointsToNext.toLocaleString()} points to ${progress.next.name}`
                : "Top of the ladder — Academic General"}
            </span>
            <span>{pointsAvailableToday(stats).toLocaleString()} points still on today</span>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            accent
            icon={<Sparkles className="h-4 w-4" />}
            label="Total points"
            value={stats.points.toLocaleString()}
          />
          <StatTile
            icon={<Flame className="h-4 w-4" />}
            label="Current streak"
            value={`${stats.currentStreak}d`}
          />
          <StatTile
            icon={<Medal className="h-4 w-4" />}
            label="Longest streak"
            value={`${stats.longestStreak}d`}
          />
          <StatTile
            accent
            icon={<Trophy className="h-4 w-4" />}
            label={ranked && myRank ? `Global rank of ${myRank.total}` : "Global rank"}
            value={rankValue}
          />
        </section>

        {boardState === "ready" && podium.length === 3 && (
          <section className="grid grid-cols-3 items-end gap-2 sm:gap-3">
            <PodiumStand row={podium[1]} place={2} isMe={podium[1].user_id === user?.id} />
            <PodiumStand row={podium[0]} place={1} isMe={podium[0].user_id === user?.id} />
            <PodiumStand row={podium[2]} place={3} isMe={podium[2].user_id === user?.id} />
          </section>
        )}

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold tracking-[-0.01em]">Global standings</h2>
              <p className="text-xs text-muted-foreground">
                {boardState === "unavailable"
                  ? "Leaderboard is warming up — check back shortly."
                  : "Top students across G&D, updated as points are earned."}
              </p>
            </div>

            {boardState === "loading" ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                Loading the leaderboard…
              </div>
            ) : board.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                No ranked students yet. Earn your first points to claim the top spot.
              </div>
            ) : (
              <div>
                {board.map((row) => {
                  const isMe = row.user_id === user?.id;
                  return (
                    <div
                      key={row.user_id}
                      className={`grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-4 py-3 transition-colors first:border-t-0 ${
                        isMe ? "bg-pop/10" : "hover:bg-foreground/[0.02]"
                      }`}
                    >
                      <PlaceBadge place={row.rank} />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold tracking-[-0.01em]">
                          {isMe ? `${row.name} (you)` : row.name}
                        </div>
                        {/* Rank is derived from the points the board already
                            returns, so naming it costs no extra column and no
                            extra query. */}
                        <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <RankBadge
                            rank={rankFromPoints(row.points)}
                            size="sm"
                            className="h-4 w-4 rounded"
                          />
                          <span className="truncate">{rankFromPoints(row.points).name}</span>
                          <span className="shrink-0">· {row.current_streak}d</span>
                        </div>
                      </div>
                      <div className="text-right text-sm font-bold tabular-nums">
                        {row.points.toLocaleString()}
                        <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                          pts
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="rounded-2xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold tracking-[-0.01em]">Recent points</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {progress.next
                ? `${progress.pointsToNext.toLocaleString()} points to ${progress.next.name}.`
                : "Every rank earned."}
            </p>
            <div className="mt-4 space-y-2">
              {stats.events.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Start a chat or complete My Coach questions to earn your first points.
                </div>
              ) : (
                stats.events.slice(0, 8).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between rounded-xl border border-border bg-background/40 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{event.label}</span>
                    <span
                      className={`font-semibold tabular-nums ${
                        event.points >= 0 ? "text-leaf" : "text-destructive"
                      }`}
                    >
                      {event.points >= 0 ? "+" : ""}
                      {event.points}
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>
    </div>
  );
}

const MEDAL_GRADIENT: Record<number, string> = {
  1: "linear-gradient(145deg, #f4d675, #d9a521)",
  2: "linear-gradient(145deg, #e6e4df, #b9b6ae)",
  3: "linear-gradient(145deg, #e0a163, #b06a2f)",
};

// The 1/2/3 medal, i.e. the PLACE on the board. Distinct from RankBadge, which
// is the academic rank (Academic Scout, Knowledge Colonel…) — the two used to
// share a name and they mean completely different things.
function PlaceBadge({ place: rank }: { place: number }) {
  if (rank <= 3) {
    return (
      <span
        className="inline-grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-[#2a2100] tabular-nums shadow-sm"
        style={{ background: MEDAL_GRADIENT[rank] }}
      >
        {rank}
      </span>
    );
  }
  return (
    <span className="inline-grid h-8 min-w-8 place-items-center rounded-full border border-border px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
      {rank}
    </span>
  );
}

function PodiumStand({ row, place, isMe }: { row: LeaderboardRow; place: number; isMe: boolean }) {
  const tall = place === 1;
  return (
    <div
      className={`rounded-t-2xl border border-b-0 px-2 py-4 text-center ${
        tall ? "pt-6" : ""
      } ${
        place === 1
          ? "border-leaf/35 bg-gradient-to-b from-leaf/12 to-transparent"
          : "border-border bg-surface"
      }`}
    >
      <span
        className="mx-auto mb-2 grid h-9 w-9 place-items-center rounded-full text-sm font-bold text-[#2a2100] shadow-sm"
        style={{ background: MEDAL_GRADIENT[place] }}
      >
        {place}
      </span>
      <div className="truncate text-[13px] font-semibold tracking-[-0.01em]">
        {isMe ? "You" : row.name}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {row.points.toLocaleString()} pts
      </div>
    </div>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div
        className={`mb-3 flex h-8 w-8 items-center justify-center rounded-lg ${
          accent ? "bg-pop/12 text-pop" : "bg-leaf/12 text-leaf"
        }`}
      >
        {icon}
      </div>
      <div className="font-display text-2xl font-light tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
