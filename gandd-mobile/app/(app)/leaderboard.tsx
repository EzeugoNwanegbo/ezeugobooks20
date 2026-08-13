// Where you stand — native port of src/routes/-app.leaderboard-page.tsx.
//
// leaderboard_top() / leaderboard_rank() are NOT part of the social schema —
// they ship from supabase/migrations/20260718120000_add_global_leaderboard.sql,
// applied and live long before SOCIAL_SCHEMA_APPLIED existed — so this screen
// carries no gate of its own; it calls both RPCs unconditionally, same as web.
//
// One thing this screen does NOT try to port: the web page reconciles and
// pushes a browser-local point journal (src/lib/gamification.ts,
// src/lib/points-ledger.ts) before reading the board, and shows a "Recent
// points" event list from that same local journal. Mobile has no such local
// ledger — lib/auth.tsx's Profile comment is explicit that points here are
// always the server's, never a local guess (see Drawer.tsx) — so there is
// nothing to reconcile or push, and no local event list to show. This screen
// reads profile.points / profile.current_streak directly and drops the
// "Recent points" panel rather than fabricate one.
import { useEffect, useMemo, useState } from "react";
import { router } from "expo-router";
import { Flame, Medal, Sparkles, Trophy } from "lucide-react-native";
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { useAuth } from "@/lib/auth";
import { rankFromPoints, rankProgress } from "@/lib/ranks";
import { supabase } from "@/lib/supabase";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar } from "@/platform";

type LeaderboardRow = {
  user_id: string;
  name: string;
  points: number;
  current_streak: number;
  rank: number;
};

const MEDAL_GRADIENT: Record<number, [string, string]> = {
  1: ["#f4d675", "#d9a521"],
  2: ["#e6e4df", "#b9b6ae"],
  3: ["#e0a163", "#b06a2f"],
};

export default function LeaderboardScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile } = useAuth();

  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [myRank, setMyRank] = useState<{ rank: number; total: number } | null>(null);
  const [boardState, setBoardState] = useState<"loading" | "ready" | "unavailable">("loading");

  const points = Math.max(0, Math.round(profile?.points ?? 0));
  const currentStreak = Math.max(0, Math.round(profile?.current_streak ?? 0));

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      setBoardState("loading");
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
  }, [user, points]);

  const progress = rankProgress(points);
  const ranked = points > 0 && myRank != null;
  const podium = useMemo(() => board.slice(0, 3), [board]);

  const rankValue =
    boardState === "loading" ? "…" : boardState === "unavailable" ? "—" : ranked && myRank ? `#${myRank.rank}` : "Unranked";

  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Leaderboard" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Your own rank, ahead of the standings — the one number the board
            itself can't show you. */}
        <View style={styles.rankCard}>
          <View style={styles.rankTop}>
            <RankBadge rank={progress.rank} size="lg" />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.rankEyebrow}>Your rank</Text>
              <Text style={styles.rankName} numberOfLines={1}>
                {progress.rank.name}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={styles.pointsValue}>{points.toLocaleString()}</Text>
              <Text style={styles.pointsLabel}>points</Text>
            </View>
          </View>
          <RankProgressBar percent={progress.percent} style={{ marginTop: 14 }} />
          <View style={styles.rankMetaRow}>
            <Text style={styles.rankMeta} numberOfLines={1}>
              {progress.next
                ? `${progress.pointsToNext.toLocaleString()} to ${progress.next.name}`
                : "Top of the ladder"}
            </Text>
            <Text style={styles.rankMeta}>{currentStreak}d streak</Text>
          </View>
        </View>

        {/* Stat tiles */}
        <View style={styles.statGrid}>
          <StatTile
            accent
            icon={<Sparkles size={16} color={colors.accent} />}
            label="Total points"
            value={points.toLocaleString()}
          />
          <StatTile
            icon={<Flame size={16} color={colors.success} />}
            label="Current streak"
            value={`${currentStreak}d`}
          />
          <StatTile
            accent
            icon={<Trophy size={16} color={colors.accent} />}
            label={ranked && myRank ? `Rank of ${myRank.total}` : "Global rank"}
            value={rankValue}
          />
        </View>

        {/* Podium */}
        {boardState === "ready" && podium.length === 3 ? (
          <View style={styles.podiumRow}>
            <PodiumStand row={podium[1]} place={2} isMe={podium[1].user_id === user?.id} />
            <PodiumStand row={podium[0]} place={1} isMe={podium[0].user_id === user?.id} tall />
            <PodiumStand row={podium[2]} place={3} isMe={podium[2].user_id === user?.id} />
          </View>
        ) : null}

        {/* Standings */}
        <View style={styles.boardCard}>
          <View style={styles.boardHead}>
            <Text style={styles.boardTitle}>Global standings</Text>
            <Text style={styles.boardSub}>
              {boardState === "unavailable"
                ? "Leaderboard is warming up — check back shortly."
                : "Top students across G&D."}
            </Text>
          </View>

          {boardState === "loading" ? (
            <ActivityIndicator size="small" color={colors.accent} style={{ paddingVertical: 32 }} />
          ) : board.length === 0 ? (
            <View style={{ paddingVertical: 32, paddingHorizontal: 16 }}>
              <Text style={styles.emptyText}>
                No ranked students yet. Earn your first points to claim the top spot.
              </Text>
            </View>
          ) : (
            board.map((row, index) => {
              const isMe = row.user_id === user?.id;
              const rowRank = rankFromPoints(row.points);
              return (
                <View
                  key={row.user_id}
                  style={[
                    styles.boardRow,
                    index === 0 && styles.boardRowFirst,
                    isMe && styles.boardRowMe,
                  ]}
                >
                  <PlaceBadge place={row.rank} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.boardName} numberOfLines={1}>
                      {isMe ? `${row.name} (you)` : row.name}
                    </Text>
                    <View style={styles.boardMetaRow}>
                      <RankBadge rank={rowRank} size="sm" style={{ width: 16, height: 16 }} />
                      <Text style={styles.boardMetaText} numberOfLines={1}>
                        {rowRank.name} · {row.current_streak}d
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.boardPoints}>
                    {row.points.toLocaleString()} <Text style={styles.boardPointsUnit}>pts</Text>
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

function PlaceBadge({ place }: { place: number }) {
  if (place <= 3) {
    const [a, b] = MEDAL_GRADIENT[place];
    return (
      <View style={[styles.placeBadge, { backgroundColor: b }]}>
        <View style={[StyleSheet.absoluteFill, styles.placeBadgeShine, { backgroundColor: a }]} />
        <Text style={styles.placeBadgeText}>{place}</Text>
      </View>
    );
  }
  return (
    <View style={styles.placeBadgeOutline}>
      <Text style={styles.placeBadgeOutlineText}>{place}</Text>
    </View>
  );
}

function PodiumStand({
  row,
  place,
  isMe,
  tall = false,
}: {
  row: LeaderboardRow;
  place: number;
  isMe: boolean;
  tall?: boolean;
}) {
  const [a] = MEDAL_GRADIENT[place];
  return (
    <View style={[styles.podiumStand, tall && styles.podiumStandTall, place === 1 && styles.podiumStandFirst]}>
      <View style={[styles.podiumMedal, { backgroundColor: a }]}>
        <Text style={styles.podiumMedalText}>{place}</Text>
      </View>
      <Text style={styles.podiumName} numberOfLines={1}>
        {isMe ? "You" : row.name}
      </Text>
      <Text style={styles.podiumPoints}>{row.points.toLocaleString()} pts</Text>
    </View>
  );
}

function StatTile({
  icon,
  label,
  value,
  accent = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: accent ? colors.accentSoft : colors.successSoft }]}>
        {icon}
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 4, gap: 12 },
  rankCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
  },
  rankTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  rankEyebrow: {
    fontFamily: fonts.bodySemibold,
    fontSize: 10.5,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: colors.accent,
  },
  rankName: { fontFamily: fonts.display, fontSize: 20, color: colors.text, marginTop: 2 },
  pointsValue: { fontFamily: fonts.display, fontSize: 22, color: colors.text },
  pointsLabel: { fontFamily: fonts.body, fontSize: 10.5, color: colors.mutedDim, marginTop: 1 },
  rankMetaRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, gap: 8 },
  rankMeta: { fontFamily: fonts.mono, fontSize: 11, color: colors.muted, flexShrink: 1 },
  statGrid: { flexDirection: "row", gap: 10 },
  statTile: {
    flex: 1,
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 14,
  },
  statIcon: {
    width: 30,
    height: 30,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  statValue: { fontFamily: fonts.display, fontSize: 17, color: colors.text },
  statLabel: { fontFamily: fonts.body, fontSize: 10.5, color: colors.mutedDim, marginTop: 2 },
  podiumRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  podiumStand: {
    flex: 1,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: "center",
    paddingVertical: 16,
    paddingHorizontal: 6,
  },
  podiumStandTall: { paddingTop: 24 },
  podiumStandFirst: {
    borderColor: "rgba(198, 169, 127, 0.35)",
    backgroundColor: colors.successSoft,
  },
  podiumMedal: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  podiumMedalText: { fontFamily: fonts.bodyBold, fontSize: 14, color: "#2a2100" },
  podiumName: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.text, maxWidth: "100%" },
  podiumPoints: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.muted, marginTop: 2 },
  boardCard: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  boardHead: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  boardTitle: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  boardSub: { fontFamily: fonts.body, fontSize: 11.5, color: colors.mutedDim, marginTop: 2 },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, textAlign: "center", lineHeight: 19 },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  boardRowFirst: { borderTopWidth: 0 },
  boardRowMe: { backgroundColor: colors.accentSoft },
  boardName: { fontFamily: fonts.bodySemibold, fontSize: 14, color: colors.text },
  boardMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  boardMetaText: { fontFamily: fonts.body, fontSize: 11.5, color: colors.muted, flexShrink: 1 },
  boardPoints: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.text },
  boardPointsUnit: { fontFamily: fonts.mono, fontSize: 9.5, color: colors.mutedDim, textTransform: "uppercase" },
  placeBadge: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  placeBadgeShine: { opacity: 0.35 },
  placeBadgeText: { fontFamily: fonts.bodyBold, fontSize: 13, color: "#2a2100" },
  placeBadgeOutline: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  placeBadgeOutlineText: { fontFamily: fonts.bodySemibold, fontSize: 12, color: colors.muted },
});
