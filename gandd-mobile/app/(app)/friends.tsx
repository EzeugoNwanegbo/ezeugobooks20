// Friends and asynchronous challenges — native port of
// src/routes/-app.friends-page.tsx. Every read and write goes through
// lib/social.ts, which is gated on SOCIAL_SCHEMA_APPLIED exactly like the web
// module it mirrors. With that flag false this screen renders ComingSoon and
// issues no query at all — the social helpers return empty before they reach
// Supabase, and the refresh effect below refuses to run.
//
// "Challenge" -> Battle Royale (2026-08-13). This screen used to open a sheet
// here that sent one of the student's own unfinished MCQ sets. That sheet is
// gone: tapping Battle now hands off to app/(app)/battle-royale.tsx, which
// builds a fresh match (file, scope, count, timer, format) and sends it itself
// via lib/social.ts's createChallenge(). This screen's job stays exactly what
// the top of the file always said — find and see a person — plus one button
// that now navigates instead of opening a dialog.
import { useCallback, useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AtSign,
  Check,
  Clock,
  Search,
  Swords,
  Trophy,
  UserMinus,
  UserPlus,
  Users,
  X,
} from "lucide-react-native";
import { ComingSoon } from "@/components/coming-soon";
import { toast } from "@/components/toast";
import { useAuth } from "@/lib/auth";
import {
  USERNAME_PATTERN,
  beginChallenge,
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
  socialEnabled,
  type ChallengeSummary,
  type Discoverability,
  type FoundStudent,
  type Friend,
  type FriendRequest,
} from "@/lib/social";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar, useHaptics } from "@/platform";

/** A settled challenge from the caller's side. Mirrors ChallengeSummary.outcome. */
type ChallengeOutcome = "won" | "lost" | "draw";

/** Wins, draws and losses — against one friend, or across the lot. */
type Tally = { won: number; drawn: number; lost: number };

// The server clamps p_limit to 100, so asking for more quietly gets 100 anyway;
// asking explicitly is the difference between a record over the last 40 battles
// and one over the last 100.
const CHALLENGE_HISTORY = 100;

export default function FriendsScreen() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const { user, profile, refreshProfile } = useAuth();

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

  const enabled = socialEnabled(user);
  const myHandle = profile?.username ?? null;
  const myVisibility: Discoverability =
    profile?.discoverable_by === "nobody" ? "nobody" : "anyone";

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
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load your friends.");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const incoming = useMemo(
    () => requests.filter((r) => r.direction === "incoming"),
    [requests],
  );
  const outgoing = useMemo(
    () => requests.filter((r) => r.direction === "outgoing"),
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

  // The win/draw/loss record — one per opponent, plus the total and the recent
  // form strip. Counted from the challenge list this screen already loads, so
  // there is no extra query and no server change behind any of it. Mirrors
  // src/routes/-app.friends-page.tsx, including the honest limit: the server
  // caps the list at 100, so a student past their hundredth battle has a record
  // over their most recent 100.
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
      haptics.success();
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
      haptics.selection();
      if (done) toast.success(done);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That didn't work.");
    } finally {
      setBusyId(null);
    }
  };

  // "Play" only gets the sitting open server-side and hands back where it
  // lives — coach.tsx has no route-param deep link into a specific session
  // (it manages plan/topic selection entirely as internal state), so the best
  // this can honestly do on mobile is land the student in My Coach and tell
  // them the set is ready, rather than silently pretending to jump into it.
  const play = async (challenge: ChallengeSummary) => {
    setBusyId(challenge.id);
    try {
      await beginChallenge(challenge.id);
      toast.success("Set is ready — open it from My Coach.");
      router.push("/coach");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open that challenge.");
    } finally {
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
    haptics.selection();
    router.push({
      pathname: "/battle-royale",
      params: { friendId: friend.user_id, friendUsername: friend.username, friendName: friend.display_name },
    });
  };

  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Friends" onBack={() => router.back()} />

      {!enabled ? (
        <ComingSoon
          icon={<Users size={30} color={colors.accent} />}
          title="Friends & challenges"
          description="Find a classmate by their handle, then challenge them to a question set. They're not switched on for everyone yet — they'll appear here once they are."
        />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Your handle ────────────────────────────────────────────── */}
          <Panel>
            <SectionTitle icon={<AtSign size={16} color={colors.accent} />} title="Your handle" />
            <Text style={styles.hint}>
              This is how friends find you. Your email is never shown to anyone.
            </Text>

            {myHandle ? (
              <View style={styles.handleRow}>
                <View style={styles.handleChip}>
                  <Text style={styles.handleChipText}>@{myHandle}</Text>
                </View>
                <Text style={styles.hintSmall}>Changeable once every 30 days.</Text>
              </View>
            ) : (
              <View style={styles.claimRow}>
                <TextInput
                  value={handleDraft}
                  onChangeText={(t) => setHandleDraft(t.toLowerCase())}
                  placeholder="pick_a_handle"
                  placeholderTextColor={colors.mutedDim}
                  maxLength={20}
                  autoCapitalize="none"
                  style={styles.claimInput}
                />
                <Pressable
                  onPress={() => void saveHandle()}
                  disabled={savingHandle || !USERNAME_PATTERN.test(handleDraft.trim().toLowerCase())}
                  style={[
                    styles.claimBtn,
                    (savingHandle || !USERNAME_PATTERN.test(handleDraft.trim().toLowerCase())) &&
                      styles.btnDisabled,
                  ]}
                >
                  {savingHandle ? (
                    <ActivityIndicator size="small" color={colors.primaryFg} />
                  ) : (
                    <Text style={styles.claimBtnText}>Claim</Text>
                  )}
                </Pressable>
              </View>
            )}
            <Text style={styles.hintSmall}>
              3-20 characters: lowercase letters, numbers and underscores.
            </Text>

            {myHandle ? (
              <View style={styles.visibilityBlock}>
                <Text style={styles.visibilityLabel}>Who can find me</Text>
                <View style={styles.segmented}>
                  {(["anyone", "nobody"] as const).map((opt) => {
                    const active = myVisibility === opt;
                    return (
                      <Pressable
                        key={opt}
                        onPress={() => void changeVisibility(opt)}
                        style={[styles.segment, active && styles.segmentActive]}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                          {opt === "anyone" ? "Anyone with my handle" : "Nobody"}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}
          </Panel>

          {/* ── Find a student ─────────────────────────────────────────── */}
          <Panel>
            <SectionTitle icon={<Search size={16} color={colors.accent} />} title="Find a student" />
            <Text style={styles.hint}>Exact handle only — there's no browse or partial search.</Text>
            <View style={styles.claimRow}>
              <TextInput
                value={query}
                onChangeText={(t) => setQuery(t.toLowerCase())}
                onSubmitEditing={() => void runSearch()}
                placeholder="their_handle"
                placeholderTextColor={colors.mutedDim}
                maxLength={20}
                autoCapitalize="none"
                style={styles.claimInput}
              />
              <Pressable
                onPress={() => void runSearch()}
                disabled={searching || !query.trim()}
                style={[styles.claimBtnSecondary, (searching || !query.trim()) && styles.btnDisabled]}
              >
                {searching ? (
                  <ActivityIndicator size="small" color={colors.text} />
                ) : (
                  <Text style={styles.claimBtnSecondaryText}>Search</Text>
                )}
              </Pressable>
            </View>

            {searched && !searching ? (
              !found ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>No student found with that handle.</Text>
                </View>
              ) : (
                <Row
                  title={found.display_name}
                  subtitle={`@${found.username} · ${found.points.toLocaleString()} pts`}
                  action={
                    found.relationship === "self" ? (
                      <Text style={styles.mutedTag}>That's you</Text>
                    ) : found.relationship === "friends" ? (
                      <Text style={[styles.mutedTag, { color: colors.success }]}>Friends</Text>
                    ) : found.relationship === "pending_out" ? (
                      <Text style={styles.mutedTag}>Request sent</Text>
                    ) : found.relationship === "pending_in" ? (
                      <Text style={styles.mutedTag}>They asked you</Text>
                    ) : (
                      <Pressable
                        disabled={busyId === found.user_id}
                        onPress={() =>
                          void act(found.user_id, () => sendFriendRequest(found.username), "Request sent.")
                        }
                        style={styles.smallBtn}
                      >
                        <UserPlus size={14} color={colors.primaryFg} />
                        <Text style={styles.smallBtnText}>Add</Text>
                      </Pressable>
                    )
                  }
                />
              )
            ) : null}
          </Panel>

          {/* ── Requests ───────────────────────────────────────────────── */}
          {incoming.length > 0 || outgoing.length > 0 ? (
            <Panel>
              <SectionTitle icon={<UserPlus size={16} color={colors.accent} />} title="Requests" />
              <View style={{ gap: 8 }}>
                {incoming.map((r) => (
                  <Row
                    key={r.user_id}
                    title={r.display_name}
                    subtitle={r.username ? `@${r.username}` : "wants to be friends"}
                    action={
                      <View style={styles.actionRow}>
                        <Pressable
                          disabled={busyId === r.user_id}
                          onPress={() =>
                            void act(r.user_id, () => respondToFriendRequest(r.user_id, true), "You're friends.")
                          }
                          style={styles.iconBtnPrimary}
                        >
                          <Check size={15} color={colors.primaryFg} />
                        </Pressable>
                        <Pressable
                          disabled={busyId === r.user_id}
                          onPress={() => void act(r.user_id, () => respondToFriendRequest(r.user_id, false))}
                          style={styles.iconBtnGhost}
                        >
                          <X size={15} color={colors.muted} />
                        </Pressable>
                      </View>
                    }
                  />
                ))}
                {outgoing.map((r) => (
                  <Row
                    key={r.user_id}
                    title={r.display_name}
                    subtitle={r.username ? `@${r.username}` : ""}
                    action={
                      <View style={styles.actionRow}>
                        <Text style={styles.mutedTag}>Waiting</Text>
                        <Pressable
                          disabled={busyId === r.user_id}
                          onPress={() => void act(r.user_id, () => removeFriend(r.user_id))}
                          style={styles.iconBtnGhost}
                        >
                          <X size={15} color={colors.muted} />
                        </Pressable>
                      </View>
                    }
                  />
                ))}
              </View>
            </Panel>
          ) : null}

          {/* ── Record ─────────────────────────────────────────────────── */}
          {settledTotal > 0 ? <RecordPanel overall={overall} form={form} /> : null}

          {/* ── Friends ────────────────────────────────────────────────── */}
          <Panel>
            <View style={styles.panelHeadRow}>
              <SectionTitle icon={<Trophy size={16} color={colors.accent} />} title="Your friends" />
            </View>
            <View style={{ gap: 8 }}>
              {loading ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ paddingVertical: 20 }} />
              ) : friends.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyText}>
                    No friends yet. Ask a classmate for their handle and search for it above.
                  </Text>
                </View>
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
            </View>
          </Panel>

          {/* ── Challenges ─────────────────────────────────────────────── */}
          {openChallenges.length > 0 ? (
            <Panel>
              <SectionTitle icon={<Swords size={16} color={colors.accent} />} title="Open battles" />
              <View style={{ gap: 8 }}>
                {openChallenges.map((c) => (
                  <ChallengeRow
                    key={c.id}
                    challenge={c}
                    busy={busyId === c.id}
                    onPlay={() => void play(c)}
                    onDecline={() => void act(c.id, () => declineChallenge(c.id), "Declined.")}
                    onCancel={() => void act(c.id, () => cancelChallenge(c.id), "Withdrawn.")}
                  />
                ))}
              </View>
            </Panel>
          ) : null}

          {settledChallenges.length > 0 ? (
            <Panel>
              <SectionTitle icon={<Clock size={16} color={colors.accent} />} title="Results" />
              <View style={{ gap: 8 }}>
                {settledChallenges.map((c) => (
                  <ChallengeRow key={c.id} challenge={c} busy={false} />
                ))}
              </View>
            </Panel>
          ) : null}
        </ScrollView>
      )}
    </ScreenContainer>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <View style={styles.panel}>{children}</View>;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      {icon}
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

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
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? <View>{action}</View> : null}
    </View>
  );
}

// Your record across every settled battle: the three counts, the split as one
// bar, and the last five results newest first.
function RecordPanel({ overall, form }: { overall: Tally; form: ChallengeOutcome[] }) {
  const total = overall.won + overall.drawn + overall.lost;
  // A draw counts as half a win, the usual convention — counting it as a loss
  // would make a drawn-heavy record read as a losing one, which it is not.
  const winRate = Math.round(((overall.won + overall.drawn / 2) / total) * 100);

  return (
    <Panel>
      <View style={styles.panelHeadRow}>
        <SectionTitle icon={<Swords size={16} color={colors.accent} />} title="Your record" />
        <Text style={styles.mutedTag}>
          {total} battle{total === 1 ? "" : "s"}
        </Text>
      </View>

      <View style={styles.statRow}>
        <StatTile value={overall.won} label="Won" tone={colors.success} soft={colors.successSoft} />
        {/* Neutral rather than copper — "success" here is a lifted copper too,
            so a copper drawn tile would sit next to the won tile as a near-twin. */}
        <StatTile
          value={overall.drawn}
          label="Drawn"
          tone={colors.muted}
          soft={colors.surfaceLowest}
        />
        <StatTile value={overall.lost} label="Lost" tone={colors.danger} soft={colors.dangerSoft} />
      </View>

      <SplitBar tally={overall} style={{ marginTop: 12 }} />

      <View style={styles.recordFootRow}>
        <Text style={styles.hint}>{winRate}% win rate</Text>
        {form.length > 0 ? (
          <View style={styles.formRow}>
            <Text style={styles.hint}>Form</Text>
            {form.map((outcome, index) => (
              <FormPip key={index} outcome={outcome} />
            ))}
          </View>
        ) : null}
      </View>
    </Panel>
  );
}

function StatTile({
  value,
  label,
  tone,
  soft,
}: {
  value: number;
  label: string;
  tone: string;
  soft: string;
}) {
  return (
    <View style={[styles.statTile, { borderColor: tone, backgroundColor: soft }]}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: tone }]}>{label}</Text>
    </View>
  );
}

// Won / drawn / lost as one bar. Every number it draws is written out beside it,
// so it is decoration rather than the only place the record is stated.
function SplitBar({ tally, style }: { tally: Tally; style?: ViewStyle }) {
  const total = tally.won + tally.drawn + tally.lost;
  if (total === 0) return null;
  return (
    <View style={[styles.splitBar, style]}>
      {tally.won > 0 ? (
        <View style={{ flex: tally.won, backgroundColor: colors.success }} />
      ) : null}
      {tally.drawn > 0 ? (
        <View style={{ flex: tally.drawn, backgroundColor: colors.muted }} />
      ) : null}
      {tally.lost > 0 ? (
        <View style={{ flex: tally.lost, backgroundColor: colors.danger }} />
      ) : null}
    </View>
  );
}

function FormPip({ outcome }: { outcome: ChallengeOutcome }) {
  const label = outcome === "won" ? "Won" : outcome === "lost" ? "Lost" : "Draw";
  const tone: string =
    outcome === "won" ? colors.success : outcome === "lost" ? colors.danger : colors.muted;
  const soft: string =
    outcome === "won"
      ? colors.successSoft
      : outcome === "lost"
        ? colors.dangerSoft
        : colors.surfaceLowest;
  return (
    <View style={[styles.formPip, { borderColor: tone, backgroundColor: soft }]}>
      <Text style={[styles.formPipText, { color: tone }]}>{label[0]}</Text>
    </View>
  );
}

// A friend, plus the head-to-head against them. The record only appears once
// there is one, so a friend you have never battled reads exactly as before.
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
  // Annotated because `colors` is a const object: without it the first
  // assignment narrows leadTone to that one hex string and the rest fail.
  let leadTone: string = colors.accent;
  if (tally && played > 0) {
    if (tally.won > tally.lost) {
      leadText = `You lead ${tally.won}–${tally.lost}`;
      leadTone = colors.success;
    } else if (tally.lost > tally.won) {
      leadText = `${shortName} leads ${tally.lost}–${tally.won}`;
      leadTone = colors.danger;
    } else if (tally.won > 0) {
      leadText = `All square ${tally.won}–${tally.lost}`;
    } else {
      // Nothing but draws, where "all square 0–0" would read as never played.
      leadText = `Level — ${tally.drawn} draw${tally.drawn === 1 ? "" : "s"}`;
    }
  }

  return (
    <View style={styles.friendRow}>
      <View style={styles.friendRowTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {friend.display_name}
          </Text>
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {friend.username ? `@${friend.username} · ` : ""}
            {friend.points.toLocaleString()} pts · {friend.current_streak}d
          </Text>
        </View>
        <View style={styles.actionRow}>
          <Pressable onPress={onBattle} style={styles.smallBtnSecondary}>
            <Swords size={13} color={colors.text} />
            <Text style={styles.smallBtnSecondaryText}>Battle</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={onRemove} style={styles.iconBtnGhost}>
            <UserMinus size={15} color={colors.muted} />
          </Pressable>
        </View>
      </View>

      {tally && played > 0 ? (
        <View style={styles.headToHead}>
          <View style={styles.headToHeadRow}>
            <Text style={[styles.headToHeadLead, { color: leadTone }]} numberOfLines={1}>
              {leadText}
            </Text>
            <Text style={styles.mutedTag}>
              {tally.won}W · {tally.drawn}D · {tally.lost}L
            </Text>
          </View>
          <SplitBar tally={tally} style={{ marginTop: 6 }} />
        </View>
      ) : null}
    </View>
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
  const opponent = challenge.opponent_username ? `@${challenge.opponent_username}` : challenge.opponent_name;

  // Level on score and still not a draw means the clock separated the two of
  // you, which is the one result that reads as a mistake unless it says so.
  const decidedOnTime =
    (challenge.outcome === "won" || challenge.outcome === "lost") &&
    challenge.my_score != null &&
    challenge.their_score != null &&
    challenge.my_score === challenge.their_score;

  const scoreline =
    challenge.my_finished_at || challenge.status === "complete"
      ? `${challenge.my_score ?? 0}-${challenge.their_score ?? "?"} of ${challenge.question_count}` +
        (challenge.my_duration_ms != null ? ` · ${formatDuration(challenge.my_duration_ms)}` : "") +
        (decidedOnTime ? " · level, decided on time" : "")
      : `${challenge.question_count} questions`;

  const outcomeColor =
    challenge.outcome === "won"
      ? colors.success
      : challenge.outcome === "lost"
        ? colors.muted
        : colors.accent;

  // Spelled out rather than a capitalised "draw": one word next to a scoreline
  // is read as the score's label, and a tie has to be unmistakable.
  const verdict =
    challenge.outcome === "won"
      ? "You won"
      : challenge.outcome === "lost"
        ? "You lost"
        : challenge.outcome === "draw"
          ? "It's a draw"
          : null;

  return (
    <View style={styles.row}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {challenge.title}
        </Text>
        <Text style={styles.rowSubtitle} numberOfLines={1}>
          {challenge.i_am_challenger ? "You challenged" : "Challenge from"} {opponent} · {scoreline}
        </Text>
      </View>
      <View style={styles.actionRow}>
        {verdict ? <Text style={[styles.mutedTag, { color: outcomeColor }]}>{verdict}</Text> : null}
        {challenge.status === "expired" ? <Text style={styles.mutedTag}>Expired</Text> : null}
        {challenge.status === "declined" ? <Text style={styles.mutedTag}>Declined</Text> : null}

        {challenge.status === "pending" || challenge.status === "active" ? (
          challenge.my_finished_at ? (
            <Text style={styles.mutedTag}>Waiting for {opponent}</Text>
          ) : (
            <>
              <Pressable disabled={busy} onPress={onPlay} style={styles.smallBtn}>
                {busy ? (
                  <ActivityIndicator size="small" color={colors.primaryFg} />
                ) : (
                  <Text style={styles.smallBtnText}>{challenge.my_started ? "Continue" : "Play"}</Text>
                )}
              </Pressable>
              {!challenge.my_started && !challenge.i_am_challenger && onDecline ? (
                <Pressable disabled={busy} onPress={onDecline} style={styles.iconBtnGhost}>
                  <X size={15} color={colors.muted} />
                </Pressable>
              ) : null}
              {challenge.i_am_challenger && !challenge.their_finished && onCancel ? (
                <Pressable disabled={busy} onPress={onCancel} style={styles.iconBtnGhost}>
                  <X size={15} color={colors.muted} />
                </Pressable>
              ) : null}
            </>
          )
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  panel: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
  },
  panelHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 4 },
  sectionTitleText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  hint: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, marginTop: 4, lineHeight: 17 },
  hintSmall: { fontFamily: fonts.body, fontSize: 11, color: colors.mutedDim, marginTop: 6 },
  claimRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  claimInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.input,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontFamily: fonts.mono,
    fontSize: 14,
  },
  claimBtn: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  claimBtnText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.primaryFg },
  claimBtnSecondary: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  claimBtnSecondaryText: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  btnDisabled: { opacity: 0.5 },
  handleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" },
  handleChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: "rgba(165, 135, 99, 0.4)",
    backgroundColor: colors.accentSoft,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  handleChipText: { fontFamily: fonts.mono, fontSize: 13, color: colors.accent },
  visibilityBlock: {
    marginTop: 16,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  visibilityLabel: {
    fontFamily: fonts.bodySemibold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.muted,
    marginBottom: 8,
  },
  segmented: {
    flexDirection: "row",
    backgroundColor: colors.surfaceLowest,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segment: { flex: 1, paddingVertical: 9, borderRadius: radius.sm, alignItems: "center" },
  segmentActive: { backgroundColor: colors.primary },
  segmentText: { fontFamily: fonts.bodyMedium, fontSize: 11.5, color: colors.muted },
  segmentTextActive: { color: colors.primaryFg },
  emptyBox: {
    marginTop: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    padding: 16,
  },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, lineHeight: 19 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLowest,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  rowSubtitle: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted, marginTop: 2 },
  // A friend row is the plain row plus the head-to-head underneath it, so it
  // stacks rather than sitting on one line.
  friendRow: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceLowest,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  friendRowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  headToHead: {
    marginTop: 10,
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  headToHeadRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  headToHeadLead: { flex: 1, minWidth: 0, fontFamily: fonts.bodySemibold, fontSize: 12 },
  statRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  statTile: { flex: 1, borderWidth: 1, borderRadius: radius.md, paddingVertical: 8, alignItems: "center" },
  statValue: { fontFamily: fonts.display, fontSize: 22 },
  statLabel: { fontFamily: fonts.body, fontSize: 11, marginTop: 1, opacity: 0.85 },
  splitBar: {
    flexDirection: "row",
    height: 6,
    borderRadius: radius.full,
    overflow: "hidden",
    backgroundColor: colors.surface,
  },
  recordFootRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    flexWrap: "wrap",
  },
  formRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  formPip: {
    width: 20,
    height: 20,
    borderWidth: 1,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  formPipText: { fontFamily: fonts.bodySemibold, fontSize: 10 },
  actionRow: { flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 },
  mutedTag: { fontFamily: fonts.mono, fontSize: 11, color: colors.mutedDim },
  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  smallBtnText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.primaryFg },
  smallBtnSecondary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  smallBtnSecondaryText: { fontFamily: fonts.bodyMedium, fontSize: 12, color: colors.text },
  iconBtnPrimary: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  iconBtnGhost: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
  },
});
