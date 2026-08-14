// Friends and asynchronous challenges.
//
// Every read and write on this page goes through src/lib/social.ts, which is
// gated on SOCIAL_SCHEMA_APPLIED. With that flag false this component still
// renders (the route exists, and somebody can always type a URL) but it renders
// the "not switched on" panel and issues no query at all — the social helpers
// return empty before they reach Supabase, and the effect below refuses to run.
//
// "Challenge" -> Battle Royale (2026-08-13). This page used to open a dialog
// here (ChallengeFriendDialog) that sent one of the student's own unfinished
// MCQ sets. That inline flow is gone: tapping Challenge now hands off to
// /app/battle-royale (-app.battle-royale-page.tsx), which builds a fresh match
// (file, scope, count, timer, format) and sends it itself via
// src/lib/social.ts's createChallenge(). This page's job stays exactly what the
// top of the file always said — find and see a person — plus one button that
// now navigates instead of opening a dialog. ChallengeFriendDialog itself is
// untouched: My Coach's "Challenge a friend" quick action
// (src/components/challenge-friend-button.tsx) still uses it for a set that is
// already built and does not belong here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  AtSign,
  Check,
  Clock,
  Loader2,
  Search,
  Swords,
  Trophy,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useAuth } from "@/lib/auth-context";
import { isGuestUser } from "@/lib/guest-session";
import { reconcileServerPoints } from "@/lib/points-ledger";
import {
  SOCIAL_SCHEMA_APPLIED,
  USERNAME_PATTERN,
  cancelChallenge,
  claimUsername,
  declineChallenge,
  findStudent,
  formatDuration,
  friendList,
  friendRequests,
  listChallenges,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  setDiscoverability,
  beginChallenge,
  socialEnabled,
  type ChallengeSummary,
  type Discoverability,
  type FoundStudent,
  type Friend,
  type FriendRequest,
} from "@/lib/social";

const VISIBILITY_OPTIONS = ["anyone", "nobody"] as const satisfies readonly Discoverability[];

/** A settled challenge from the caller's side. Mirrors ChallengeSummary.outcome. */
type ChallengeOutcome = "won" | "lost" | "draw";

/** Wins, draws and losses — against one friend, or across the lot. */
type Tally = { won: number; drawn: number; lost: number };

// How many challenges to count the record over. The server clamps p_limit to
// 100, so asking for more would quietly get 100 anyway; asking for it explicitly
// is the difference between a record over the last 40 battles and the last 100.
const CHALLENGE_HISTORY = 100;

export function FriendsPage() {
  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  const [friends, setFriends] = useState<Friend[]>([]);
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [challenges, setChallenges] = useState<ChallengeSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [handleDraft, setHandleDraft] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [found, setFound] = useState<FoundStudent | null>(null);

  const [busyId, setBusyId] = useState<string | null>(null);

  // Hooks run unconditionally; the gate lives inside them and in the render.
  const enabled = socialEnabled(user);
  const isGuest = isGuestUser(user);
  const myHandle = profile?.username ?? null;
  // Defaults to "anyone" when the column is absent (flag off) or unset. Harmless
  // either way: with no handle claimed, find_student() returns nothing regardless.
  const myVisibility: Discoverability = profile?.discoverable_by === "nobody" ? "nobody" : "anyone";

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [f, r, c] = await Promise.all([
        friendList(),
        friendRequests(),
        listChallenges(CHALLENGE_HISTORY),
      ]);
      setFriends(f);
      setRequests(r);
      setChallenges(c);
      // listChallenges() sweeps first, which is where a finished contest is
      // actually resolved - and therefore where a win is actually awarded. Pick
      // the award up straight away so the points appear with the result rather
      // than the next time the leaderboard is opened. A no-op until the ledger
      // migration is applied, and it never throws.
      if (user) await reconcileServerPoints(user.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your friends.");
    } finally {
      setLoading(false);
    }
  }, [enabled, user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const incoming = useMemo(
    () => requests.filter((request) => request.direction === "incoming"),
    [requests],
  );
  const outgoing = useMemo(
    () => requests.filter((request) => request.direction === "outgoing"),
    [requests],
  );
  const openChallenges = useMemo(
    () => challenges.filter((c) => c.status === "pending" || c.status === "active"),
    [challenges],
  );
  const settledChallenges = useMemo(
    () => challenges.filter((c) => c.status !== "pending" && c.status !== "active"),
    [challenges],
  );

  // The win/draw/loss record: one per opponent, plus the total and the recent
  // form strip. Counted here from the challenge list the page already loads, so
  // there is no extra query and no server change behind any of it.
  //
  // The one honest limit: challenge_list_mine() caps at 100 rows, so a student
  // past their hundredth challenge has a record over the most recent 100. The
  // heading says "your battles" rather than "all time" for exactly that reason.
  const { tallies, overall, form } = useMemo(() => {
    const tallies = new Map<string, Tally>();
    const overall: Tally = { won: 0, drawn: 0, lost: 0 };
    const form: ChallengeOutcome[] = [];
    for (const challenge of challenges) {
      const outcome = challenge.outcome;
      if (!outcome) continue;
      const tally = tallies.get(challenge.opponent_user_id) ?? { won: 0, drawn: 0, lost: 0 };
      if (outcome === "won") {
        tally.won += 1;
        overall.won += 1;
      } else if (outcome === "lost") {
        tally.lost += 1;
        overall.lost += 1;
      } else {
        tally.drawn += 1;
        overall.drawn += 1;
      }
      tallies.set(challenge.opponent_user_id, tally);
      // Newest first, matching the server's ordering, and only the last five -
      // "form" is meant to be read at a glance, not audited.
      if (form.length < 5) form.push(outcome);
    }
    return { tallies, overall, form };
  }, [challenges]);
  const settledTotal = overall.won + overall.drawn + overall.lost;

  const saveHandle = async () => {
    setSavingHandle(true);
    try {
      const value = await claimUsername(handleDraft);
      await refreshProfile();
      setHandleDraft("");
      toast.success(`Your handle is @${value}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that handle.");
    } finally {
      setSavingHandle(false);
    }
  };

  const changeVisibility = async (mode: Discoverability) => {
    try {
      await setDiscoverability(mode);
      await refreshProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change that setting.");
    }
  };

  const runSearch = async () => {
    setSearching(true);
    setSearched(false);
    try {
      setFound(await findStudent(query));
    } catch {
      setFound(null);
    } finally {
      setSearching(false);
      setSearched(true);
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

  // Hands off to Battle Royale with the target already chosen, so the setup
  // screen skips straight to "which file" instead of asking who to fight again.
  // Battle Royale itself calls createChallenge() once the match is built.
  const openBattle = (friend: Friend) => {
    if (!friend.username) {
      toast.error(`${friend.display_name} hasn't picked a handle yet, so they can't be battled.`);
      return;
    }
    navigate({
      to: "/app/battle-royale",
      search: {
        friendId: friend.user_id,
        friendUsername: friend.username,
        friendName: friend.display_name,
      },
    });
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-6 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <PageHeader
          eyebrow="Friends"
          title="Study against someone"
          subtitle="Find a classmate by their handle, then send them a question set. You each play it whenever you like — highest score wins, fastest finish breaks a tie."
        />
        {children}
      </div>
    </div>
  );

  if (!SOCIAL_SCHEMA_APPLIED) {
    return shell(
      <Panel>
        <p className="text-sm text-muted-foreground">
          Friends and challenges aren&apos;t switched on yet. They&apos;ll appear here once
          they&apos;re live.
        </p>
      </Panel>,
    );
  }

  if (isGuest) {
    return shell(
      <Panel>
        <p className="text-sm text-muted-foreground">
          You&apos;re in a guest session. Guest sessions disappear when you sign out, so they
          can&apos;t hold friendships — create a free account and everything you&apos;ve made comes
          with you.
        </p>
      </Panel>,
    );
  }

  return shell(
    <>
      {/* ── Your handle ─────────────────────────────────────────────────── */}
      <Panel>
        <SectionTitle icon={<AtSign className="h-4 w-4" />} title="Your handle" />
        <p className="mt-1 text-xs text-muted-foreground">
          This is how friends find you. It&apos;s the only thing about you that&apos;s searchable —
          your email is never shown to anyone, and never will be.
        </p>

        {myHandle ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <span className="rounded-full border border-pop/40 bg-pop/10 px-3 py-1.5 font-mono text-sm text-pop">
              @{myHandle}
            </span>
            <span className="text-xs text-muted-foreground">
              Handles can be changed once every 30 days.
            </span>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Input
              value={handleDraft}
              onChange={(event) => setHandleDraft(event.target.value.toLowerCase())}
              placeholder="pick_a_handle"
              maxLength={20}
              className="font-mono"
              aria-label="Choose your handle"
            />
            <Button
              onClick={() => void saveHandle()}
              disabled={savingHandle || !USERNAME_PATTERN.test(handleDraft.trim().toLowerCase())}
              className="shrink-0"
            >
              {savingHandle ? <Loader2 className="h-4 w-4 animate-spin" /> : "Claim it"}
            </Button>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          3–20 characters: lowercase letters, numbers and underscores. First come, first served, so
          treat it as permanent.
        </p>

        {myHandle && (
          <div className="mt-5 border-t border-border/60 pt-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Who can find me
            </div>
            <div className="mt-2 max-w-xs">
              <Segmented<Discoverability>
                value={myVisibility}
                onChange={(value) => void changeVisibility(value)}
                options={VISIBILITY_OPTIONS}
                getLabel={(option) => (option === "anyone" ? "Anyone with my handle" : "Nobody")}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              &ldquo;Nobody&rdquo; hides you from search without giving up your handle. Friends you
              already have are unaffected.
            </p>
          </div>
        )}
      </Panel>

      {/* ── Find a student ──────────────────────────────────────────────── */}
      <Panel>
        <SectionTitle icon={<Search className="h-4 w-4" />} title="Find a student" />
        <p className="mt-1 text-xs text-muted-foreground">
          Exact handle only. There&apos;s no browse or partial search on purpose — it would let
          anyone page through the whole student list.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value.toLowerCase())}
            onKeyDown={(event) => {
              if (event.key === "Enter") void runSearch();
            }}
            placeholder="their_handle"
            maxLength={20}
            className="font-mono"
            aria-label="Search by handle"
          />
          <Button
            variant="secondary"
            onClick={() => void runSearch()}
            disabled={searching || !query.trim()}
            className="shrink-0"
          >
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </div>

        {searched && !searching && (
          <div className="mt-4">
            {!found ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                No student found with that handle. Check the spelling — handles are exact.
              </p>
            ) : (
              <Row
                title={found.display_name}
                subtitle={`@${found.username} · ${found.points.toLocaleString()} pts`}
                action={
                  found.relationship === "self" ? (
                    <span className="text-xs text-muted-foreground">That&apos;s you</span>
                  ) : found.relationship === "friends" ? (
                    <span className="text-xs text-leaf">Already friends</span>
                  ) : found.relationship === "pending_out" ? (
                    <span className="text-xs text-muted-foreground">Request sent</span>
                  ) : found.relationship === "pending_in" ? (
                    <span className="text-xs text-muted-foreground">They asked you</span>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busyId === found.user_id}
                      onClick={() =>
                        void act(
                          found.user_id,
                          () => sendFriendRequest(found.username),
                          "Request sent.",
                        )
                      }
                    >
                      <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                      Add
                    </Button>
                  )
                }
              />
            )}
          </div>
        )}
      </Panel>

      {/* ── Requests ────────────────────────────────────────────────────── */}
      {(incoming.length > 0 || outgoing.length > 0) && (
        <Panel>
          <SectionTitle icon={<UserPlus className="h-4 w-4" />} title="Requests" />
          <div className="mt-3 space-y-2">
            {incoming.map((request) => (
              <Row
                key={request.user_id}
                title={request.display_name}
                subtitle={request.username ? `@${request.username}` : "wants to be friends"}
                action={
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      disabled={busyId === request.user_id}
                      onClick={() =>
                        void act(
                          request.user_id,
                          () => respondToFriendRequest(request.user_id, true),
                          "You're friends.",
                        )
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span className="sr-only">Accept</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === request.user_id}
                      onClick={() =>
                        void act(request.user_id, () =>
                          respondToFriendRequest(request.user_id, false),
                        )
                      }
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Decline</span>
                    </Button>
                  </div>
                }
              />
            ))}
            {outgoing.map((request) => (
              <Row
                key={request.user_id}
                title={request.display_name}
                subtitle={request.username ? `@${request.username}` : ""}
                action={
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Waiting</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busyId === request.user_id}
                      onClick={() => void act(request.user_id, () => removeFriend(request.user_id))}
                    >
                      <X className="h-3.5 w-3.5" />
                      <span className="sr-only">Cancel request</span>
                    </Button>
                  </div>
                }
              />
            ))}
          </div>
        </Panel>
      )}

      {/* ── Record ──────────────────────────────────────────────────────── */}
      {settledTotal > 0 && <RecordPanel overall={overall} form={form} />}

      {/* ── Friends ─────────────────────────────────────────────────────── */}
      <Panel>
        <SectionTitle icon={<Trophy className="h-4 w-4" />} title="Your friends" />
        <div className="mt-3 space-y-2">
          {loading ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
          ) : friends.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
              No friends yet. Ask a classmate for their handle and search for it above.
            </p>
          ) : (
            friends.map((friend) => (
              <FriendRow
                key={friend.user_id}
                friend={friend}
                tally={tallies.get(friend.user_id) ?? null}
                busy={busyId === friend.user_id}
                onBattle={() => openBattle(friend)}
                onRemove={() =>
                  void act(friend.user_id, () => removeFriend(friend.user_id), "Removed.")
                }
              />
            ))
          )}
        </div>
      </Panel>

      {/* ── Challenges ──────────────────────────────────────────────────── */}
      {openChallenges.length > 0 && (
        <Panel>
          <SectionTitle icon={<Swords className="h-4 w-4" />} title="Open challenges" />
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
    </>,
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">{children}</section>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold tracking-[-0.01em]">
      <span className="text-pop">{icon}</span>
      {title}
    </h2>
  );
}

// One list row. The 360px case is what the wrapping and min-w-0 are for: the
// name truncates and the action keeps its full width rather than being squeezed.
function Row({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold tracking-[-0.01em]">{title}</div>
        {subtitle && (
          <div className="truncate font-mono text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// Your record across every settled battle: the three counts, the split as one
// bar, and the last five results newest first. It is a read of what the page
// already fetched - no extra call, and nothing here is stored anywhere.
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

// A friend, plus the head-to-head against them. The record only appears once
// there is one: a friend you have never battled reads exactly as it did before.
function FriendRow({
  friend,
  tally,
  busy,
  onBattle,
  onRemove,
}: {
  friend: Friend;
  tally: Tally | null;
  busy: boolean;
  onBattle: () => void;
  onRemove: () => void;
}) {
  const played = tally ? tally.won + tally.drawn + tally.lost : 0;
  const shortName = friend.username ? `@${friend.username}` : friend.display_name.split(" ")[0];

  let leadText = "";
  let leadTone = "text-pop";
  if (tally && played > 0) {
    if (tally.won > tally.lost) {
      leadText = `You lead ${tally.won}–${tally.lost}`;
      leadTone = "text-leaf";
    } else if (tally.lost > tally.won) {
      leadText = `${shortName} leads ${tally.lost}–${tally.won}`;
      leadTone = "text-destructive";
    } else if (tally.won > 0) {
      leadText = `All square ${tally.won}–${tally.lost}`;
    } else {
      // Nothing but draws, where "all square 0–0" would read as never played.
      leadText = `Level — ${tally.drawn} draw${tally.drawn === 1 ? "" : "s"}`;
    }
  }

  return (
    <div className="rounded-xl border border-border bg-background/40 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-[-0.01em]">
            {friend.display_name}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {friend.username ? `@${friend.username} · ` : ""}
            {friend.points.toLocaleString()} pts · {friend.current_streak}d
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="secondary" onClick={onBattle}>
            <Swords className="mr-1.5 h-3.5 w-3.5" />
            Challenge
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRemove}>
            <UserMinus className="h-3.5 w-3.5" />
            <span className="sr-only">Remove friend</span>
          </Button>
        </div>
      </div>

      {tally && played > 0 && (
        <div className="mt-2.5 border-t border-border/60 pt-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={`min-w-0 truncate font-semibold ${leadTone}`}>{leadText}</span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {tally.won}W · {tally.drawn}D · {tally.lost}L
            </span>
          </div>
          <SplitBar tally={tally} className="mt-1.5" />
        </div>
      )}
    </div>
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
