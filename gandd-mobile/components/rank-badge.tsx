// The rank badge and its progress bar — the native twin of
// src/components/rank-badge.tsx. Same icons, same ladder, same rules.
//
// Tiers are expressed as FILL WEIGHT, not hue. The product has exactly one
// accent (Faded Copper), so a bronze/silver/gold scheme would collapse into
// four near-identical badges. Outline → tint → strong tint → solid reads as a
// ladder without introducing a single new colour.

import {
  Award,
  ChevronsUp,
  ChevronUp,
  Compass,
  Crown,
  Gem,
  type LucideIcon,
  Medal,
  Shield,
  ShieldCheck,
  Star,
  Trophy,
} from "lucide-react-native";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";
import { type AcademicRank, rankProgress, type RankTier } from "@/lib/ranks";
import { colors, fonts, radius } from "@/lib/theme";

const RANK_ICONS: Record<string, LucideIcon> = {
  recruit: Shield,
  cadet: ShieldCheck,
  scout: Compass,
  corporal: ChevronUp,
  sergeant: ChevronsUp,
  lieutenant: Star,
  captain: Award,
  major: Medal,
  colonel: Gem,
  commander: Crown,
  general: Trophy,
};

const TIER: Record<RankTier, { bg: string; border: string; fg: string }> = {
  0: { bg: colors.tint, border: colors.border, fg: colors.muted },
  1: { bg: "rgba(165, 135, 99, 0.10)", border: "rgba(165, 135, 99, 0.30)", fg: colors.primary },
  2: { bg: "rgba(165, 135, 99, 0.20)", border: "rgba(165, 135, 99, 0.50)", fg: colors.primary },
  3: { bg: colors.primary, border: colors.primary, fg: colors.primaryFg },
};

const SIZES = {
  sm: { box: 24, radius: radius.sm, icon: 14 },
  md: { box: 36, radius: radius.md, icon: 18 },
  lg: { box: 64, radius: radius.xxl, icon: 32 },
} as const;

export function RankBadge({
  rank,
  size = "md",
  style,
}: {
  rank: AcademicRank;
  size?: keyof typeof SIZES;
  style?: ViewStyle;
}) {
  const Icon = RANK_ICONS[rank.id] ?? Shield;
  const s = SIZES[size];
  const tier = TIER[rank.tier];
  return (
    <View
      style={[
        {
          width: s.box,
          height: s.box,
          borderRadius: s.radius,
          backgroundColor: tier.bg,
          borderColor: tier.border,
          borderWidth: 1,
          alignItems: "center",
          justifyContent: "center",
        },
        style,
      ]}
    >
      <Icon size={s.icon} color={tier.fg} strokeWidth={2} />
    </View>
  );
}

/** The thin bar used everywhere a rank is shown with its progress. */
export function RankProgressBar({ percent, style }: { percent: number; style?: ViewStyle }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <View style={[styles.track, style]}>
      <View style={[styles.fill, { width: `${pct}%` }]} />
    </View>
  );
}

/**
 * Badge + rank name + progress bar. One block, reused wherever a rank appears
 * so it reads identically on every screen.
 */
export function RankSummary({ points, style }: { points: number; style?: ViewStyle }) {
  const progress = rankProgress(points);
  return (
    <View style={[styles.summary, style]}>
      <RankBadge rank={progress.rank} size="md" />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rankName} numberOfLines={1}>
          {progress.rank.name}
        </Text>
        <RankProgressBar percent={progress.percent} style={{ marginTop: 6 }} />
        <Text style={styles.rankMeta} numberOfLines={1}>
          {progress.next
            ? `${progress.pointsToNext.toLocaleString()} pts to ${progress.next.name}`
            : "Top rank reached"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.tintStrong,
    overflow: "hidden",
  },
  fill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  rankName: {
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    color: colors.text,
    letterSpacing: -0.14,
  },
  rankMeta: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.muted,
    marginTop: 4,
  },
});
