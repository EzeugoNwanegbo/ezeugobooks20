// Open Battle Royale challenges, their results, and the overall record.
//
// Split out of the old all-in-one friends page: starting a battle happens on
// /app/battle-royale (picked from a friend on -app.friends-page.tsx), and
// this page is purely for what happens after — play it, watch it settle, see
// the record. It is the only friends page that touches challenge data at all.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Clock, Loader2, Swords, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";
import { reconcileServerPoints } from "@/lib/points-ledger";
import {
  cancelChallenge,
  declineChallenge,
  formatDuration,
  listChallenges,
  beginChallenge,
  type ChallengeSummary,
} from "@/lib/social";
import { EmptyState, FriendsPageFrame, Panel, SectionTitle } from "@/routes/-app.friends-shared";

// How many challenges to count the record over. The server clamps p_limit to
// 100, so asking for more would quietly get 100 anyway; asking for it
// explicitly is the difference between a record over the last 40 battles and
// the last 100.
const CHALLENGE_HISTORY = 100;

/** A settled challenge from the caller's side. Mirrors ChallengeSummary.outcome. */
type ChallengeOutcome = "won" | "lost" | "draw";

/** Wins, draws and losses — against one friend, or across the lot. */
type Tally = { won: number; drawn: number; lost: number };

export function FriendsBattlesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const c = await listChallenges(CHALLENGE_HISTORY);
      setChallenges(c);
      // listChallenges() sweeps first, which is where a finished contest is
      // actually resolved - and therefore where a win is actually awarded.
      // Pick the award up straight away so the points appear with the result
      // rather than the next time the leaderboard is opened. A no-op until
      // the ledger migration is applied, and it never throws.
      if (user) await reconcileServerPoints(user.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your battles.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openChallenges = useMemo(
    () => challenges.filter((c) => c.status === "pending" || c.status === "active"),
    [challenges],
  );
  const settledChallenges = useMemo(
    () => challenges.filter((c) => c.status !== "pending" && c.status !== "active"),
    [challenges],
  );

  // The win/draw/loss record, counted here from the challenge list this page
  // already loads - no extra query. The one honest limit: challenge_list_mine()
  // caps at 100 rows, so a student past their hundredth challenge has a record
  // over the most recent 100.
  const { overall, form } = useMemo(() => {
    const overall: Tally = { won: 0, drawn: 0, lost: 0 };
    const form: ChallengeOutcome[] = [];
    for (const challenge of challenges) {
      const outcome = challenge.outcome;
      if (!outcome) continue;
      if (outcome === "won") overall.won += 1;
      else if (outcome === "lost") overall.lost += 1;
      else overall.drawn += 1;
      // Newest first, matching the server's ordering, and only the last five -
      // "form" is meant to be read at a glance, not audited.
      if (form.length < 5) form.push(outcome);
    }
    return { overall, form };
  }, [challenges]);
  const settledTotal = overall.won + overall.drawn + overall.lost;

  const play = async (challenge: ChallengeSummary) => {
    setBusyId(challenge.id);
    try {
      const { sessionId, planId } = await beginChallenge(challenge.id);
      navigate({ to: "/app/practice", search: { session: sessionId, plan: planId, mode: "exam" } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open that challenge.");
      setBusyId(null);
    }
  };

  const act = async (id: string, work: () => Promise<unknown>, done?: string) => {
    setBusyId(id);
    try {
      await work();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  };

  const nothingYet = !loading && openChallenges.length === 0 && settledChallenges.length === 0;

  return (
    <FriendsPageFrame active="battles" title="Battles">
      {loading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
      ) : nothingYet ? (
        <EmptyState
          icon={<Swords className="h-8 w-8" />}
          text="No battles yet."
          action={
            <Button onClick={() => void navigate({ to: "/app/friends" })}>
              Challenge a friend
            </Button>
          }
        />
      ) : (
        <>
          {settledTotal > 0 && <RecordPanel overall={overall} form={form} />}

          {openChallenges.length > 0 && (
            <Panel>
              <SectionTitle icon={<Swords className="h-4 w-4" />} title="Open" />
              <div className="mt-3 space-y-2">
                {openChallenges.map((challenge) => (
                  <ChallengeRow
                    key={challenge.id}
                    challenge={challenge}
                    busy={busyId === challenge.id}
                    onPlay={() => void play(challenge)}
                    onDecline={() =>
                      void act(challenge.id, () => declineChallenge(challenge.id), "Declined.")
                    }
                    onCancel={() =>
                      void act(challenge.id, () => cancelChallenge(challenge.id), "Withdrawn.")
                    }
                  />
                ))}
              </div>
            </Panel>
          )}

          {settledChallenges.length > 0 && (
            <Panel>
              <SectionTitle icon={<Clock className="h-4 w-4" />} title="Results" />
              <div className="mt-3 space-y-2">
                {settledChallenges.map((challenge) => (
                  <ChallengeRow key={challenge.id} challenge={challenge} busy={false} />
                ))}
              </div>
            </Panel>
          )}
        </>
      )}
    </FriendsPageFrame>
  );
}

// Won / drawn / lost, the split as one bar, and the last five results newest
// first. It is a read of what this page already fetched - no extra call.
function RecordPanel({ overall, form }: { overall: Tally; form: ChallengeOutcome[] }) {
  const total = overall.won + overall.drawn + overall.lost;
  // A draw counts as half a win, the usual convention. Counting it as a loss
  // would make a drawn-heavy record read as a losing one, which it is not.
  const winRate = Math.round(((overall.won + overall.drawn / 2) / total) * 100);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-3">
        <SectionTitle icon={<Swords className="h-4 w-4" />} title="Your record" />
        <span className="shrink-0 font-mono text-xs text-muted-foreground">
          {total} battle{total === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat value={overall.won} label="Won" tone="border-leaf/30 bg-leaf/10 text-leaf" />
        {/* Neutral rather than copper: --leaf and --pop resolve to the SAME hex
            in the light theme, so a copper "drawn" tile would be a win tile. */}
        <Stat value={overall.drawn} label="Drawn" tone="border-border bg-foreground/[0.04]" />
        <Stat
          value={overall.lost}
          label="Lost"
          tone="border-destructive/30 bg-destructive/5 text-destructive"
        />
      </div>

      <SplitBar tally={overall} className="mt-3" />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{winRate}% win rate</span>
        {form.length > 0 && (
          <span className="flex items-center gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Form</span>
            {form.map((outcome, index) => (
              <FormPip key={index} outcome={outcome} />
            ))}
          </span>
        )}
      </div>
    </Panel>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className={`rounded-xl border p-2 text-center ${tone}`}>
      <div className="font-display text-2xl font-light">{value}</div>
      <div className="text-[11px] opacity-80">{label}</div>
    </div>
  );
}

// Won / drawn / lost as one bar. Decorative — every number it draws is written
// out beside it, so it is hidden from screen readers rather than duplicated.
function SplitBar({ tally, className = "" }: { tally: Tally; className?: string }) {
  const total = tally.won + tally.drawn + tally.lost;
  if (total === 0) return null;
  const width = (part: number) => `${(part / total) * 100}%`;
  return (
    <div
      aria-hidden
      className={`flex h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06] ${className}`}
    >
      <span className="bg-leaf" style={{ width: width(tally.won) }} />
      <span className="bg-foreground/30" style={{ width: width(tally.drawn) }} />
      <span className="bg-destructive/70" style={{ width: width(tally.lost) }} />
    </div>
  );
}

function FormPip({ outcome }: { outcome: ChallengeOutcome }) {
  const label = outcome === "won" ? "Won" : outcome === "lost" ? "Lost" : "Draw";
  const tone =
    outcome === "won"
      ? "border-leaf/40 bg-leaf/15 text-leaf"
      : outcome === "lost"
        ? "border-destructive/40 bg-destructive/10 text-destructive"
        : "border-border bg-foreground/[0.06] text-foreground";
  return (
    <span
      title={label}
      className={`grid h-5 w-5 place-items-center rounded-md border text-[10px] font-bold ${tone}`}
    >
      {label[0]}
    </span>
  );
}

function ChallengeRow({
  challenge,
  busy,
  onPlay,
  onDecline,
  onCancel,
}: {
  challenge: ChallengeSummary;
  busy: boolean;
  onPlay?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
}) {
  const opponent = challenge.opponent_username
    ? `@${challenge.opponent_username}`
    : challenge.opponent_name;

  // The scoreline is only ever rendered from what the server chose to return.
  // their_score is null until you have played or the challenge has settled, so
  // there is no branch here that could show it early.
  // Level on score and still not a draw means the clock separated the two of
  // you, which is the one result that reads as a mistake unless it says so.
  const decidedOnTime =
    (challenge.outcome === "won" || challenge.outcome === "lost") &&
    challenge.my_score != null &&
    challenge.their_score != null &&
    challenge.my_score === challenge.their_score;

  const scoreline =
    challenge.my_finished_at || challenge.status === "complete"
      ? `${challenge.my_score ?? 0}–${challenge.their_score ?? "?"} of ${challenge.question_count}` +
        (challenge.my_duration_ms != null ? ` · ${formatDuration(challenge.my_duration_ms)}` : "") +
        (decidedOnTime ? " · level on score, decided on time" : "")
      : `${challenge.question_count} questions`;

  const outcomeTone =
    challenge.outcome === "won"
      ? "border-leaf/40 bg-leaf/10 text-leaf"
      : challenge.outcome === "lost"
        ? "border-border bg-foreground/[0.04] text-muted-foreground"
        : // A draw. Not copper: --pop and --leaf are the same hex in the light
          // theme, so a copper badge here would read as a win.
          "border-border bg-foreground/[0.08] text-foreground";

  // Spelled out rather than a capitalised "draw": a one-word badge next to a
  // scoreline is read as the score's label, and a tie has to be unmistakable.
  const verdict =
    challenge.outcome === "won"
      ? "You won"
      : challenge.outcome === "lost"
        ? "You lost"
        : challenge.outcome === "draw"
          ? "It's a draw"
          : null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">{challenge.title}</div>
        <div className="truncate text-xs text-muted-foreground">
          {challenge.i_am_challenger ? "You challenged" : "Challenge from"} {opponent} · {scoreline}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {verdict && (
          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${outcomeTone}`}>
            {verdict}
          </span>
        )}
        {challenge.status === "expired" && (
          <span className="text-xs text-muted-foreground">Expired</span>
        )}
        {challenge.status === "declined" && (
          <span className="text-xs text-muted-foreground">Declined</span>
        )}

        {(challenge.status === "pending" || challenge.status === "active") && (
          <>
            {challenge.my_finished_at ? (
              <span className="text-xs text-muted-foreground">Waiting for {opponent}</span>
            ) : (
              <Button size="sm" disabled={busy} onClick={onPlay}>
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : challenge.my_started ? (
                  "Continue"
                ) : (
                  "Play"
                )}
              </Button>
            )}
            {!challenge.my_started && !challenge.i_am_challenger && onDecline && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onDecline}>
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Decline</span>
              </Button>
            )}
            {challenge.i_am_challenger && !challenge.their_finished && onCancel && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
                <X className="h-3.5 w-3.5" />
                <span className="sr-only">Withdraw</span>
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
