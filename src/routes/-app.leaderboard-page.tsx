import { Flame, Medal, Sparkles, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  emptyGamificationStats,
  levelFromPoints,
  loadGamificationStats,
  pointsToNextLevel,
  type GamificationStats,
} from "@/lib/gamification";

export function LeaderboardPage() {
  const { user, profile } = useAuth();
  const [stats, setStats] = useState<GamificationStats>(() =>
    user ? loadGamificationStats(user.id) : emptyGamificationStats(),
  );

  useEffect(() => {
    if (!user) return;
    setStats(loadGamificationStats(user.id));
    const onChange = () => setStats(loadGamificationStats(user.id));
    window.addEventListener("gd:gamification", onChange);
    return () => window.removeEventListener("gd:gamification", onChange);
  }, [user]);

  const rows = useMemo(() => {
    return [
      {
        name: profile?.name || "You",
        points: stats.points,
        weeklyPoints: stats.weeklyPoints,
        streak: stats.currentStreak,
        current: true,
      },
    ];
  }, [profile?.name, stats]);

  const level = levelFromPoints(stats.points);

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
            Earn points for showing up, answering My Coach questions, and completing roadmaps.
          </p>
        </header>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Sparkles className="h-4 w-4" />} label="Total points" value={stats.points} />
          <StatCard icon={<Flame className="h-4 w-4" />} label="Current streak" value={`${stats.currentStreak}d`} />
          <StatCard icon={<Medal className="h-4 w-4" />} label="Level" value={level} />
          <StatCard icon={<Trophy className="h-4 w-4" />} label="Global rank" value="Pending" />
        </section>

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="luxury-panel overflow-hidden rounded-lg">
            <div className="border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Your standing</h2>
              <p className="text-xs text-muted-foreground">
                Global ranking will appear here after leaderboard sync is connected.
              </p>
            </div>
            <div className="divide-y divide-border/70">
              {rows.map((row, index) => (
                <div
                  key={`${row.name}-${index}`}
                  className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 ${
                    "current" in row ? "bg-primary/8" : ""
                  }`}
                >
                  <div className="text-sm text-muted-foreground">#{index + 1}</div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.weeklyPoints} this week - {row.streak} day streak
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold">{row.points} pts</div>
                </div>
              ))}
            </div>
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
                    <span className={event.points >= 0 ? "text-emerald-400" : "text-destructive"}>
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
