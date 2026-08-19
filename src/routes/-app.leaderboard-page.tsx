// The leaderboard: three boards, one page, no instructions.
//
// WHAT WAS REMOVED AND WHY
// ------------------------
// This page used to open with "Where you stand" over a sentence explaining how
// points are earned, then stack four stat tiles, a podium, a captioned board
// and a captioned sidebar - seven blocks, three of which restated each other.
// A leaderboard only has to answer two questions: where am I, and who is above
// me. So it is now your standing, then the list, and nothing else on screen.
// The medal colours on places 1-3 do what the podium did; the streak lives on
// each row; the points history is one collapsed disclosure at the foot.
//
// The three boards are the same component with different rows behind them, so
// switching tabs never changes the shape of the page.
import { ChevronDown, Flame, GraduationCap, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/segmented";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { rankFromPoints, rankProgress } from "@/lib/ranks";
import {
  emptyGamificationStats,
  loadGamificationStats,
  pushGamificationToServer,
  type GamificationStats,
} from "@/lib/gamification";
import { reconcileServerPoints } from "@/lib/points-ledger";
import { socialEnabled } from "@/lib/social";
import { fetchSchoolBoard, ownSchoolName, type SchoolBoard } from "@/lib/school";

/**
 * The weekly board needs leaderboard_week() / leaderboard_week_rank() from
 * supabase/migrations/20260818120000_school_and_week_leaderboards.sql.
 *
 * Detected, not hand-flipped - the reason is written out at length over
 * `schoolRpcMissing` in src/lib/school.ts. Short version: migrations here are
 * applied by hand, and a constant meant the owner could run the SQL and watch
 * nothing change until a second code change also shipped. The fetch below
 * already treats any error as "unavailable" and falls back to the student's OWN
 * week from the local points history, so probing costs one request and can
 * never break the page.
 *
 * Only a missing FUNCTION latches this. A network blip must not, or one bad
 * moment would hide the board until a reload.
 */
let weekRpcMissing = false;

function isMissingFunction(error: unknown): boolean {
  const e = error as { code?: string | null; message?: string | null } | null;
  if (!e) return false;
  if (e.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(e.message ?? "");
}

type BoardTab = "global" | "school" | "week";

const TAB_LABEL: Record<BoardTab, string> = {
  global: "Global",
  school: "School",
  week: "This week",
};

/** One row of any of the three boards. `rank` is null when it is not known. */
type BoardRow = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  rank: number | null;
};

type LoadState = "loading" | "ready" | "unavailable";

type RpcRow = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  rank: number;
};

/** Monday 00:00 local, matching date_trunc('week', …) on the server. */
function startOfWeek(now = new Date()): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - ((day.getDay() + 6) % 7));
  return day.getTime();
}

/**
 * Points this device recorded since Monday.
 *
 * The fallback behind the This week tab while the weekly RPC is unapplied. The
 * local history is capped at 30 events, so a very heavy week can undercount -
 * it is a floor, not an audit, and it is replaced outright by the server total
 * as soon as the weekly RPC answers.
 */
function localWeekPoints(stats: GamificationStats): number {
  const since = startOfWeek();
  return stats.events.reduce((sum, event) => {
    const at = Date.parse(event.createdAt);
    return Number.isFinite(at) && at >= since ? sum + event.points : sum;
  }, 0);
}

export function LeaderboardPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<GamificationStats>(() =>
    user ? loadGamificationStats(user.id) : emptyGamificationStats(),
  );
  const [tab, setTab] = useState<BoardTab>("global");

  const [global, setGlobal] = useState<BoardRow[]>([]);
  const [globalRank, setGlobalRank] = useState<{ rank: number; total: number } | null>(null);
  const [globalState, setGlobalState] = useState<LoadState>("loading");

  const [school, setSchool] = useState<SchoolBoard | null>(null);
  const [schoolState, setSchoolState] = useState<LoadState>("loading");

  const [week, setWeek] = useState<BoardRow[]>([]);
  const [weekRank, setWeekRank] = useState<{ rank: number; total: number; points: number } | null>(
    null,
  );
  const [weekState, setWeekState] = useState<LoadState>("loading");

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
      setGlobalState("loading");
      // Order matters. Reconcile first so anything the server awarded (today,
      // only a challenge win) is folded into the local cache, THEN push - so
      // the total that lands on the leaderboard includes it rather than
      // overwriting it with a browser total that never knew about it.
      await reconcileServerPoints(user.id);
      await pushGamificationToServer(user.id);
      const [top, rank] = await Promise.all([
        supabase.rpc("leaderboard_top", { limit_count: 50 }),
        supabase.rpc("leaderboard_rank"),
      ]);
      if (!active) return;
      if (top.error || rank.error) {
        setGlobalState("unavailable");
        return;
      }
      setGlobal(((top.data as RpcRow[]) ?? []).map((row) => ({ ...row, rank: row.rank })));
      setGlobalRank((rank.data as { rank: number; total: number }[])?.[0] ?? null);
      setGlobalState("ready");
    })();
    return () => {
      active = false;
    };
  }, [user, stats.points]);

  // The school board is only fetched when its tab is open: it is the one query
  // on this page a student may never ask for.
  useEffect(() => {
    if (tab !== "school" || !user) return;
    let active = true;
    (async () => {
      setSchoolState("loading");
      const board = await fetchSchoolBoard(profile?.university);
      if (!active) return;
      setSchool(board);
      setSchoolState(board ? "ready" : "unavailable");
    })();
    return () => {
      active = false;
    };
  }, [tab, user, profile?.university]);

  useEffect(() => {
    if (tab !== "week" || !user) return;
    if (weekRpcMissing) {
      setWeekState("unavailable");
      return;
    }
    let active = true;
    (async () => {
      setWeekState("loading");
      const db = supabase as unknown as {
        rpc: (
          fn: string,
          args?: Record<string, unknown>,
        ) => PromiseLike<{
          data: unknown;
          error: unknown;
        }>;
      };
      const [top, rank] = await Promise.all([
        db.rpc("leaderboard_week", { limit_count: 50 }),
        db.rpc("leaderboard_week_rank"),
      ]);
      if (!active) return;
      if (top.error || rank.error) {
        if (isMissingFunction(top.error) || isMissingFunction(rank.error)) weekRpcMissing = true;
        setWeekState("unavailable");
        return;
      }
      setWeek(((top.data as RpcRow[]) ?? []).map((row) => ({ ...row, rank: row.rank })));
      setWeekRank((rank.data as { rank: number; total: number; points: number }[])?.[0] ?? null);
      setWeekState("ready");
    })();
    return () => {
      active = false;
    };
  }, [tab, user]);

  const progress = rankProgress(stats.points);
  const schoolName = school?.name ?? ownSchoolName(profile?.university);
  const hasSchool = Boolean(schoolName);

  const tabs = useMemo<BoardTab[]>(
    // Guests are left out of the school board for the same reason they are left
    // out of friends: an anonymous session is discarded on sign-out, so ranking
    // it against a named cohort is a promise the app cannot keep.
    () => (socialEnabled(user) ? ["global", "school", "week"] : ["global", "week"]),
    [user],
  );
  useEffect(() => {
    if (!tabs.includes(tab)) setTab("global");
  }, [tabs, tab]);

  const myRow = useMemo<BoardRow>(
    () => ({
      user_id: user?.id ?? "me",
      name: profile?.name?.trim() || "You",
      points: stats.points,
      current_streak: stats.currentStreak,
      rank: null,
    }),
    [user?.id, profile?.name, stats.points, stats.currentStreak],
  );

  const mySchoolPlace = useMemo(() => {
    if (!school || !user) return null;
    const mine = school.rows.find((row) => row.user_id === user.id);
    return mine ? { rank: mine.rank, total: school.cohort } : null;
  }, [school, user]);

  const weekPoints = weekRank?.points ?? localWeekPoints(stats);

  const openSettings = useCallback(() => {
    void navigate({ to: "/app/settings" });
  }, [navigate]);

  // ── What the "you" strip says on each tab ────────────────────────────────
  let context = "Global";
  let place: ReactNode = "Unranked";
  let points = stats.points;

  if (tab === "global") {
    if (globalState === "loading") place = "…";
    else if (globalState === "unavailable") place = "—";
    else if (globalRank && stats.points > 0) place = `#${globalRank.rank} of ${globalRank.total}`;
  } else if (tab === "school") {
    context = schoolName ?? "School";
    place = mySchoolPlace ? `#${mySchoolPlace.rank} of ${mySchoolPlace.total}` : "—";
  } else {
    context = "This week";
    points = weekPoints;
    if (weekState === "loading") place = "…";
    else if (weekRank && weekRank.points > 0) place = `#${weekRank.rank} of ${weekRank.total}`;
    else place = "—";
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <PageHeader eyebrow="Ranking" title="Leaderboard" />

        <Segmented<BoardTab>
          options={tabs}
          value={tab}
          onChange={setTab}
          getLabel={(option) => TAB_LABEL[option]}
        />

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center gap-3">
            <RankBadge rank={progress.rank} size="lg" />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-pop">
                  {context}
                </span>
                {stats.currentStreak > 0 && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
                    <Flame className="h-3 w-3" />
                    {stats.currentStreak}
                  </span>
                )}
              </div>
              <div className="truncate font-display text-2xl font-light tracking-[-0.02em]">
                {place}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="font-display text-2xl font-light tabular-nums">
                {points.toLocaleString()}
              </div>
              <div className="text-[11px] text-muted-foreground">points</div>
            </div>
          </div>

          {tab === "global" && (
            <>
              <RankProgressBar percent={progress.percent} className="mt-4" />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
                <span>{progress.rank.name}</span>
                <span>
                  {progress.next
                    ? `${progress.pointsToNext.toLocaleString()} to ${progress.next.name}`
                    : "Academic General"}
                </span>
              </div>
            </>
          )}
        </section>

        {tab === "global" && (
          <Board
            rows={global}
            meId={user?.id}
            loading={globalState === "loading"}
            empty={
              globalState === "unavailable" ? "Leaderboard unavailable." : "No one ranked yet."
            }
          />
        )}

        {tab === "school" && !hasSchool && (
          <EmptyCard
            icon={<GraduationCap className="h-5 w-5" />}
            line="No school on your profile."
            action={
              <Button size="sm" onClick={openSettings}>
                Set your school
              </Button>
            }
          />
        )}

        {tab === "school" && hasSchool && (
          <Board
            rows={school?.rows ?? [myRow]}
            meId={user?.id}
            loading={schoolState === "loading"}
            empty="No one ranked yet."
            // Honest about what the client can see: with the school RPC
            // unapplied the only row it can read is the caller's own.
            note={school ? undefined : "Just you so far."}
          />
        )}

        {tab === "week" && (
          <Board
            rows={weekState === "ready" ? week : [{ ...myRow, points: weekPoints }]}
            meId={user?.id}
            loading={weekState === "loading"}
            empty="No points yet this week."
            note={weekState === "ready" ? undefined : "Just you so far."}
          />
        )}

        {stats.events.length > 0 && (
          <details className="group overflow-hidden rounded-2xl border border-border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
              Recent points
              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="space-y-2 px-4 pb-4">
              {stats.events.slice(0, 8).map((event) => (
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
              ))}
            </div>
          </details>
        )}
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
// is the academic rank (Academic Scout, Knowledge Colonel…) - the two used to
// share a name and they mean completely different things.
function PlaceBadge({ place }: { place: number | null }) {
  if (place == null) {
    return (
      <span className="inline-grid h-8 min-w-8 place-items-center rounded-full border border-dashed border-border text-xs text-muted-foreground">
        ·
      </span>
    );
  }
  if (place <= 3) {
    return (
      <span
        className="inline-grid h-8 w-8 place-items-center rounded-full text-sm font-bold text-[#2a2100] tabular-nums shadow-sm"
        style={{ background: MEDAL_GRADIENT[place] }}
      >
        {place}
      </span>
    );
  }
  return (
    <span className="inline-grid h-8 min-w-8 place-items-center rounded-full border border-border px-1.5 text-xs font-semibold tabular-nums text-muted-foreground">
      {place}
    </span>
  );
}

/** The list, identical on all three tabs so switching never reshapes the page. */
function Board({
  rows,
  meId,
  loading,
  empty,
  note,
}: {
  rows: BoardRow[];
  meId: string | undefined;
  loading: boolean;
  empty: string;
  note?: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface">
      {loading ? (
        <div className="grid place-items-center px-4 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-muted-foreground">{empty}</div>
      ) : (
        <>
          {rows.map((row) => {
            const isMe = row.user_id === meId;
            return (
              <div
                key={row.user_id}
                className={`grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border/60 px-4 py-3 transition-colors first:border-t-0 ${
                  isMe ? "bg-pop/10" : "hover:bg-foreground/[0.02]"
                }`}
              >
                <PlaceBadge place={row.rank} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold tracking-[-0.01em]">
                    {isMe ? `${row.name} (you)` : row.name}
                  </div>
                  {/* The academic rank is derived from the points the board
                      already returns, so naming it costs no extra column and no
                      extra query. */}
                  <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <RankBadge
                      rank={rankFromPoints(row.points)}
                      size="sm"
                      className="h-4 w-4 rounded"
                    />
                    <span className="truncate">{rankFromPoints(row.points).name}</span>
                    {row.current_streak > 0 && (
                      <span className="shrink-0 tabular-nums">· {row.current_streak}d</span>
                    )}
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
          {note && (
            <div className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
              {note}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EmptyCard({ icon, line, action }: { icon: ReactNode; line: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface px-4 py-12 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-xl bg-pop/12 text-pop">
        {icon}
      </span>
      <p className="text-sm text-muted-foreground">{line}</p>
      {action}
    </section>
  );
}
