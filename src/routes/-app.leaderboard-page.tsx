import { Flame, Medal, Sparkles, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  emptyGamificationStats,
  levelFromPoints,
  loadGamificationStats,
  pointsToNextLevel,
  pushGamificationToServer,
  type GamificationStats,
} from "@/lib/gamification";

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

  // Push our latest local points to the shared board, then pull the rankings.
  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setBoardState("loading");
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

  const level = levelFromPoints(stats.points);
  const ranked = stats.points > 0 && myRank != null;

  const globalRankValue = useMemo<ReactNode>(() => {
    if (boardState === "loading") return "…";
    if (boardState === "unavailable") return "—";
    if (!ranked) return "Unranked";
    return `#${myRank.rank}`;
  }, [boardState, ranked, myRank]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="gd-leaderboard-header rounded-lg border border-amber-400/20 p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
            <Trophy className="h-4 w-4" />
            Leaderboard
          </div>
          <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
            Points, streaks, and study momentum.
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Earn points for showing up, answering My Coach questions, and completing roadmaps — then
            see where you stand against every other student.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Total points" value={stats.points} />
          <StatCard icon={<Flame className="h-4 w-4" />} label="Current streak" value={`${stats.currentStreak}d`} />
          <StatCard icon={<Medal className="h-4 w-4" />} label="Level" value={level} />
          <StatCard
            icon={<Trophy className="h-4 w-4" />}
            label={ranked && myRank ? `Global rank of ${myRank.total}` : "Global rank"}
            value={globalRankValue}
          />
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="luxury-panel overflow-hidden rounded-lg">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Global standings</h2>
              <p className="text-xs text-muted-foreground">
                {boardState === "unavailable"
                  ? "Leaderboard is warming up — check back shortly."
                  : "Top students across G&D, updated as points are earned."}
              </p>
            </div>

            {boardState === "loading" ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Loading the leaderboard…
              </div>
            ) : board.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No ranked students yet. Earn your first points to claim the top spot.
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {board.map((row) => {
                  const isMe = row.user_id === user?.id;
                  return (
                    <div
                      key={row.user_id}
                      className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 ${
                        isMe ? "bg-pop/10" : ""
                      }`}
                    >
                      <div className="flex items-center">
                        <RankBadge rank={row.rank} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">
                          {isMe ? `${row.name} (you)` : row.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {row.current_streak} day streak
                        </div>
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums">
                        {row.points.toLocaleString()} pts
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <aside className="luxury-panel rounded-lg p-4">
            <h2 className="text-sm font-semibold">Recent points</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {pointsToNextLevel(stats.points)} points to level {level + 1}.
            </p>
            <div className="mt-4 space-y-2">
              {stats.events.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Start a chat or complete My Coach questions to earn your first points.
                </div>
              ) : (
                stats.events.slice(0, 8).map((event) => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between rounded-lg border border-border bg-background/40 px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{event.label}</span>
                    <span className={event.points >= 0 ? "text-leaf" : "text-destructive"}>
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

function RankBadge({ rank }: { rank: number }) {
  const medal =
    rank === 1
      ? "bg-amber-400/20 text-amber-300 border-amber-400/40"
      : rank === 2
        ? "bg-zinc-300/15 text-zinc-300 border-zinc-300/30"
        : rank === 3
          ? "bg-orange-500/15 text-orange-300 border-orange-400/30"
          : "border-border text-muted-foreground";
  return (
    <span
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full border px-1.5 text-xs font-semibold tabular-nums ${medal}`}
    >
      {rank}
    </span>
  );
}

function StatCard({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="luxury-panel rounded-lg p-4">
      <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
        {icon}
      </div>
      <div className="font-display text-2xl font-light">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
