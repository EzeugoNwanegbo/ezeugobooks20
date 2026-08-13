// G&D — Battle Royale: the host-side setup screen for an async friend match.
//
// Replaces the old "New challenge" sheet in friends.tsx (pick one of your own
// unfinished MCQ sets and send it). Here the host configures a FRESH match —
// which file, whole file or one topic, how many questions, how long to finish,
// whole-file vs roadmap format — and this screen builds it and sends it in one
// action. It is deliberately "a different type of My Coach": same document
// picking and scope pattern as coach.tsx's roadmap builder, but its own local
// UI (coach.tsx is owned by another change in flight and its QUESTION_COUNTS
// answers a different question — practice-set size, not a capped PvP set size).
//
// EXAM MODE ONLY, MCQ ONLY, ALWAYS — see lib/battle-royale-client.ts for why
// both are non-negotiable (brief + the challenge_create() RPC's own guard).
//
// ROADMAP FORMAT IS VISIBLE BUT NOT BUILDABLE. A multi-stage "win per roadmap
// topic" match needs tables this schema does not have yet (no per-stage
// challenge row, no way to gate stage N+1 on stage N's result). The option is
// shown, disabled, and its Send path is never reachable — see the format
// section below. No query, RPC call or column name for it is written anywhere
// in this file.
import { useCallback, useEffect, useMemo, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  AlertTriangle,
  Check,
  Clock,
  FileText,
  Lock,
  Send,
  Swords,
  Users,
} from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ComingSoon } from "@/components/coming-soon";
import { toast } from "@/components/toast";
import { Button, EmptyState, Field, Tag } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  BATTLE_MAX_MINUTES,
  BATTLE_MAX_QUESTIONS,
  BATTLE_MIN_MINUTES,
  BATTLE_MIN_QUESTIONS,
  BATTLE_SCHEMA_APPLIED,
  createBattleSession,
  type DocRow,
  folderName,
  loadBattleDocuments,
} from "@/lib/battle-royale-client";
import { createChallenge, friendList, socialEnabled, type Friend } from "@/lib/social";
import { colors, fonts, radius } from "@/lib/theme";
import { BOTTOM_NAV_HEIGHT, MainTabContainer, TopBar, useDrawer, useHaptics } from "@/platform";

type Scope = "whole" | "topic";
type Format = "single" | "roadmap";

// Offered per the brief. 10 fits inside the server's 12-question challenge cap
// (BATTLE_MAX_QUESTIONS, mirrored from challenge_create()'s own guard); 20 and
// 30 do not, so they are shown — the design is real — but disabled rather than
// wired to a call that challenge_create() would refuse after the AI spend.
const COUNT_PRESETS = [10, 20, 30] as const;

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export default function BattleRoyaleScreen() {
  const { open } = useDrawer();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const params = useLocalSearchParams<{
    friendId?: string;
    friendUsername?: string;
    friendName?: string;
  }>();

  // Arrived from Friends' "Battle" button with a target already chosen — back
  // returns there. Arrived from the bottom tab directly — this is a main tab
  // like its three siblings, so the affordance matches theirs (menu, not back).
  const cameWithOpponent = Boolean(params.friendUsername);

  const enabled = socialEnabled(user);

  // ── Opponent ────────────────────────────────────────────────────────────
  const [opponent, setOpponent] = useState<{ userId: string; username: string; name: string } | null>(
    params.friendUsername
      ? {
          userId: params.friendId ?? "",
          username: params.friendUsername,
          name: params.friendName ?? params.friendUsername,
        }
      : null,
  );
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);

  useEffect(() => {
    if (!enabled || opponent) return;
    setFriendsLoading(true);
    void friendList()
      .then(setFriends)
      .catch(() => setFriends([]))
      .finally(() => setFriendsLoading(false));
  }, [enabled, opponent]);

  // A friend who never claimed a handle cannot be the target of challenge_create
  // (it takes a username, not a uuid) — the same guard friends.tsx applies
  // before opening its old sheet.
  const challengeableFriends = useMemo(() => friends.filter((f) => f.username), [friends]);

  // ── Setup state ─────────────────────────────────────────────────────────
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("whole");
  const [topicFocus, setTopicFocus] = useState("");
  const [format, setFormat] = useState<Format>("single");

  const [countPreset, setCountPreset] = useState<number | "custom">(10);
  const [customCount, setCustomCount] = useState(String(BATTLE_MAX_QUESTIONS));
  const [minutes, setMinutes] = useState("15");

  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!user) return;
    setDocsLoading(true);
    loadBattleDocuments(user.id)
      .then(setDocs)
      .catch((err) => toast.error(err instanceof Error ? err.message : "Could not load your files"))
      .finally(() => setDocsLoading(false));
  }, [user]);

  const selectedDoc = docs.find((d) => d.id === selectedDocId) ?? null;

  // The resolved question count this match will actually be built with — a
  // preset already inside the server cap, or whatever survives clamping the
  // custom field. Bounds: BATTLE_MIN_QUESTIONS (3 — a 1-2 question match is not
  // really a contest) to BATTLE_MAX_QUESTIONS (12 — challenge_create()'s own
  // hard ceiling). A blank, zero, negative or absurd ("5000") custom entry all
  // resolve inside that range rather than reaching session creation.
  const resolvedCount = useMemo(() => {
    if (countPreset !== "custom") return countPreset;
    const parsed = parseInt(customCount, 10);
    return clampInt(parsed, BATTLE_MIN_QUESTIONS, BATTLE_MAX_QUESTIONS);
  }, [countPreset, customCount]);

  const resolvedMinutes = useMemo(() => {
    const parsed = parseInt(minutes, 10);
    return clampInt(parsed, BATTLE_MIN_MINUTES, BATTLE_MAX_MINUTES);
  }, [minutes]);

  const explainRoadmapLocked = useCallback(() => {
    Alert.alert(
      "Roadmap battles are coming soon",
      "A multi-stage battle with a win for each roadmap topic needs a database change that hasn't shipped yet. For now every Battle Royale match is a single, whole-file round.",
    );
  }, []);

  const canSend =
    enabled &&
    Boolean(opponent) &&
    Boolean(selectedDoc) &&
    (scope === "whole" || topicFocus.trim().length > 0) &&
    format === "single" &&
    !sending;

  const send = async () => {
    if (!user || !profile || !opponent || !selectedDoc) return;
    if (scope === "topic" && !topicFocus.trim()) {
      toast.error("Type the topic this battle should focus on, or switch to the whole file.");
      return;
    }
    setSending(true);
    try {
      const { sessionId } = await createBattleSession({
        userId: user.id,
        profile,
        doc: selectedDoc,
        scope,
        topicFocus,
        count: resolvedCount,
        timeLimitMinutes: resolvedMinutes,
      });
      // The limit only becomes a real constraint once the migration is applied:
      // before that there is no challenges.time_limit_minutes for it to live in,
      // and challenge_begin() would not carry it onto the opponent's copy even if
      // there were. Until then it travels in the title only (see buildBattleTitle)
      // — a pace both players are told, not one anything enforces.
      await createChallenge(
        opponent.username,
        sessionId,
        BATTLE_SCHEMA_APPLIED ? resolvedMinutes : undefined,
      );
      haptics.success();
      toast.success(`Battle sent to @${opponent.username}.`);
      if (cameWithOpponent) router.back();
      else setOpponent(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send that battle");
    } finally {
      setSending(false);
    }
  };

  if (!enabled) {
    return (
      <MainTabContainer>
        <TopBar title="Battle Royale" onMenu={cameWithOpponent ? undefined : open} onBack={cameWithOpponent ? () => router.back() : undefined} />
        <ComingSoon
          icon={<Swords size={30} color={colors.accent} />}
          title="Battle Royale"
          description="Async friend matches aren't switched on for everyone yet — they'll appear here once they are."
        />
      </MainTabContainer>
    );
  }

  const scrollPad = { paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 32 };

  return (
    <MainTabContainer>
      <TopBar
        title="Battle Royale"
        onMenu={cameWithOpponent ? undefined : open}
        onBack={cameWithOpponent ? () => router.back() : undefined}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, scrollPad]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {!opponent ? (
          <>
            <View style={styles.kicker}>
              <Swords size={15} color={colors.accent} />
              <Text style={styles.kickerText}>BATTLE ROYALE</Text>
            </View>
            <Text style={styles.h1}>Who are you battling?</Text>
            <Text style={styles.sub}>
              Pick a friend to build a match for. Add friends from the Friends screen first if
              nobody shows up here.
            </Text>

            <View style={styles.card}>
              {friendsLoading ? (
                <EmptyState text="Loading your friends…" />
              ) : challengeableFriends.length === 0 ? (
                <EmptyState text="No friends ready to battle yet. Add one from the Friends screen." />
              ) : (
                <View style={{ gap: 8 }}>
                  {challengeableFriends.map((f) => (
                    <Pressable
                      key={f.user_id}
                      onPress={() => {
                        haptics.selection();
                        setOpponent({ userId: f.user_id, username: f.username as string, name: f.display_name });
                      }}
                      style={[styles.row, styles.rowIdle]}
                    >
                      <Users size={16} color={colors.accent} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {f.display_name}
                        </Text>
                        <Text style={styles.rowSubtitle}>@{f.username}</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          </>
        ) : (
          <>
            <View style={styles.kicker}>
              <Swords size={15} color={colors.accent} />
              <Text style={styles.kickerText}>SETTING UP A MATCH</Text>
            </View>
            <Text style={styles.h1}>Battle @{opponent.username}</Text>
            <Text style={styles.sub}>
              Exam mode only — nothing is revealed until you both finish. Configure it, then send.
            </Text>

            {/* File */}
            <View style={styles.card}>
              <SectionHead icon={<FileText size={15} color={colors.accent} />} title="Which file" />
              {docsLoading ? (
                <EmptyState text="Loading your files…" />
              ) : docs.length === 0 ? (
                <EmptyState text="Upload a file in Library first." />
              ) : (
                <View style={{ gap: 8 }}>
                  {docs.map((doc) => {
                    const selected = selectedDocId === doc.id;
                    return (
                      <Pressable
                        key={doc.id}
                        onPress={() => {
                          haptics.selection();
                          setSelectedDocId(doc.id);
                        }}
                        style={[styles.row, selected ? styles.rowActive : styles.rowIdle]}
                      >
                        <FileText size={16} color={colors.accent} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.rowTitle} numberOfLines={1}>
                            {doc.file_name}
                          </Text>
                          <Text style={styles.rowSubtitle}>{folderName(doc) || "Uncategorised"}</Text>
                        </View>
                        {selected ? <Check size={16} color={colors.accent} /> : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Scope */}
            {selectedDoc ? (
              <View style={styles.card}>
                <SectionHead icon={<FileText size={15} color={colors.accent} />} title="Scope" />
                <View style={styles.pillRow}>
                  <Pill label="The whole file" active={scope === "whole"} onPress={() => setScope("whole")} />
                  <Pill label="A specific topic" active={scope === "topic"} onPress={() => setScope("topic")} />
                </View>
                {scope === "topic" ? (
                  <Field
                    value={topicFocus}
                    onChangeText={setTopicFocus}
                    placeholder="e.g. Cranial nerves, Consideration in contract law…"
                    style={{ marginTop: 10 }}
                  />
                ) : null}
              </View>
            ) : null}

            {/* Question count */}
            <View style={styles.card}>
              <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Questions" />
              <View style={styles.pillRow}>
                {COUNT_PRESETS.map((n) => {
                  const overCap = n > BATTLE_MAX_QUESTIONS;
                  return (
                    <Pill
                      key={n}
                      label={n.toString()}
                      active={countPreset === n}
                      disabled={overCap}
                      onPress={() => (overCap ? undefined : setCountPreset(n))}
                    />
                  );
                })}
                <Pill label="Custom" active={countPreset === "custom"} onPress={() => setCountPreset("custom")} />
              </View>
              {countPreset === "custom" ? (
                <Field
                  value={customCount}
                  onChangeText={setCustomCount}
                  keyboardType="number-pad"
                  placeholder={`${BATTLE_MIN_QUESTIONS}-${BATTLE_MAX_QUESTIONS}`}
                  style={{ marginTop: 10 }}
                />
              ) : null}
              {/* Two different truths, and the screen must not tell the wrong one:
                  with the migration unapplied the cap really is 12 and the bigger
                  presets really are unreachable; once it lands they simply work,
                  and an apology for a limit that no longer exists reads as a bug. */}
              <View style={styles.hintRow}>
                <AlertTriangle size={12} color={colors.mutedDim} style={{ marginTop: 1 }} />
                <Text style={styles.hint}>
                  {BATTLE_SCHEMA_APPLIED
                    ? `Battles run up to ${BATTLE_MAX_QUESTIONS} questions — the largest set the ` +
                      `server will build for a fair, gradeable contest. This match will use ${resolvedCount}.`
                    : `Battles are capped at ${BATTLE_MAX_QUESTIONS} questions for now — that is the ` +
                      `server's own limit for a fair, gradeable contest. 20 and 30 will unlock once ` +
                      `that cap is raised. This match will use ${resolvedCount}.`}
                </Text>
              </View>
            </View>

            {/* Time to finish */}
            <View style={styles.card}>
              <SectionHead icon={<Clock size={15} color={colors.accent} />} title="Time to finish" />
              <Field
                value={minutes}
                onChangeText={setMinutes}
                keyboardType="number-pad"
                placeholder="Minutes"
                style={{ marginTop: 2 }}
              />
              <Text style={styles.hint}>
                {BATTLE_MIN_MINUTES}-{BATTLE_MAX_MINUTES} minutes. This match will give
                {" "}{resolvedMinutes} min — shown to your opponent, not force-submitted.
              </Text>
            </View>

            {/* Format */}
            <View style={styles.card}>
              <SectionHead icon={<Swords size={15} color={colors.accent} />} title="Format" />
              <Pressable
                onPress={() => setFormat("single")}
                style={[styles.formatRow, format === "single" ? styles.rowActive : styles.rowIdle]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>Whole-file overview</Text>
                  <Text style={styles.rowSubtitle}>One round. Finish it, see the result.</Text>
                </View>
                {format === "single" ? <Check size={16} color={colors.accent} /> : null}
              </Pressable>
              <Pressable onPress={explainRoadmapLocked} style={[styles.formatRow, styles.rowDisabled]}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.rowTitle}>Roadmap</Text>
                  <Text style={styles.rowSubtitle}>A win for each roadmap stage.</Text>
                </View>
                <Tag label="SOON" tone="neutral" />
                <Lock size={14} color={colors.mutedDim} style={{ marginLeft: 8 }} />
              </Pressable>
            </View>

            <Button
              label={sending ? "Sending…" : `Send battle to @${opponent.username}`}
              onPress={send}
              disabled={!canSend}
              loading={sending}
              icon={<Send size={16} color={colors.primaryFg} />}
              style={{ marginTop: 4 }}
            />
            <Button
              label="Choose someone else"
              variant="secondary"
              onPress={() => setOpponent(null)}
              style={{ marginTop: 10 }}
            />
          </>
        )}
      </ScrollView>
    </MainTabContainer>
  );
}

function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.sectionHead}>
      {icon}
      <Text style={styles.sectionHeadText}>{title}</Text>
    </View>
  );
}

function Pill({
  label,
  active,
  disabled = false,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={[
        styles.pill,
        active ? styles.pillActive : styles.pillIdle,
        disabled && styles.pillDisabled,
      ]}
    >
      <Text
        style={[
          styles.pillLabel,
          { color: active ? colors.primaryFg : disabled ? colors.faint : colors.muted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 14 },
  kicker: { flexDirection: "row", alignItems: "center", gap: 6 },
  kickerText: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.2, color: colors.accent },
  h1: { fontFamily: fonts.soraSemibold, fontSize: 26, color: colors.text, lineHeight: 31, marginTop: 2 },
  sub: { fontFamily: fonts.body, fontSize: 13.5, color: colors.mutedDim, lineHeight: 20, marginTop: -4 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 18 },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionHeadText: { color: colors.text, fontSize: 16, fontFamily: fonts.soraSemibold },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  rowActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  rowIdle: { borderColor: colors.border, backgroundColor: colors.surfaceLowest },
  rowDisabled: { borderColor: colors.border, backgroundColor: colors.surfaceLowest, opacity: 0.55, marginTop: 8 },
  rowTitle: { color: colors.text, fontSize: 14, fontFamily: fonts.bodySemibold },
  rowSubtitle: { color: colors.mutedDim, fontSize: 12, marginTop: 2, fontFamily: fonts.body },
  formatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: { flexGrow: 1, borderRadius: radius.full, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", minHeight: 44, justifyContent: "center" },
  pillActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  pillIdle: { borderColor: colors.border, backgroundColor: "transparent" },
  pillDisabled: { borderColor: colors.border, backgroundColor: "transparent", opacity: 0.4 },
  pillLabel: { fontSize: 12.5, fontFamily: fonts.bodySemibold },
  hintRow: { flexDirection: "row", gap: 6, marginTop: 12 },
  hint: { flex: 1, color: colors.mutedDim, fontSize: 11.5, lineHeight: 16, fontFamily: fonts.body, marginTop: 8 },
});
