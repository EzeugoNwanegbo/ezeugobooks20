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
      const [f, r, c] = await Promise.all([friendList(), friendRequests(), listChallenges()]);
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
                  <Row
                    key={friend.user_id}
                    title={friend.display_name}
                    subtitle={`${friend.username ? `@${friend.username} · ` : ""}${friend.points.toLocaleString()} pts · ${friend.current_streak}d`}
                    action={
                      <View style={styles.actionRow}>
                        <Pressable onPress={() => openBattle(friend)} style={styles.smallBtnSecondary}>
                          <Swords size={13} color={colors.text} />
                          <Text style={styles.smallBtnSecondaryText}>Battle</Text>
                        </Pressable>
                        <Pressable
                          disabled={busyId === friend.user_id}
                          onPress={() => void act(friend.user_id, () => removeFriend(friend.user_id), "Removed.")}
                          style={styles.iconBtnGhost}
                        >
                          <UserMinus size={15} color={colors.muted} />
                        </Pressable>
                      </View>
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

  const scoreline =
    challenge.my_finished_at || challenge.status === "complete"
      ? `${challenge.my_score ?? 0}-${challenge.their_score ?? "?"} of ${challenge.question_count}` +
        (challenge.my_duration_ms != null ? ` · ${formatDuration(challenge.my_duration_ms)}` : "")
      : `${challenge.question_count} questions`;

  const outcomeColor =
    challenge.outcome === "won"
      ? colors.success
      : challenge.outcome === "lost"
        ? colors.muted
        : colors.accent;

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
        {challenge.outcome ? (
          <Text style={[styles.mutedTag, { color: outcomeColor, textTransform: "capitalize" }]}>
            {challenge.outcome}
          </Text>
        ) : null}
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
