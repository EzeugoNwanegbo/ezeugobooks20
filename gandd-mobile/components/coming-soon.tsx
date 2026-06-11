import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "@/lib/theme";

// Placeholder for screens not yet ported natively (chat, library, history,
// feedback land here in this phase). Keeps navigation complete and on-brand.
export function ComingSoon({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.iconWrap}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.desc}>{description}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>Coming to the native app soon</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: colors.text, fontSize: 24, fontWeight: "300", marginTop: 22 },
  desc: {
    color: colors.muted,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 300,
    lineHeight: 21,
  },
  badge: {
    marginTop: 22,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  badgeText: { color: colors.accent, fontSize: 12, fontWeight: "600" },
});
