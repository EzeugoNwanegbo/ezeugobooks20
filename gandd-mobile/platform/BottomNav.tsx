import { router, usePathname } from "expo-router";
import { BookOpen, type LucideIcon, MessageSquare, NotebookPen, Zap } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius } from "@/lib/theme";
import { haptics } from "./useHaptics";
import { isMainRoute } from "./useBackNavigation";
import { setPendingDir, tabIndex } from "./tab-transition";

export const BOTTOM_NAV_HEIGHT = 62;

const TABS: { key: string; label: string; icon: LucideIcon; route: string }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare, route: "/chat" },
  { key: "library", label: "Library", icon: BookOpen, route: "/library" },
  { key: "last-minute", label: "Last Min", icon: Zap, route: "/last-minute" },
  { key: "coach", label: "Coach", icon: NotebookPen, route: "/coach" },
];

// Persistent 4-tab bar shared across the main screens; hidden on secondary
// (drawer) screens. Switching tabs uses replace so the stack never piles up.
export function BottomNav() {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  if (!isMainRoute(pathname)) return null;

  return (
    <View
      style={[
        styles.wrap,
        { height: BOTTOM_NAV_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
      ]}
    >
      {TABS.map(({ key, label, icon: Icon, route }) => {
        const active = pathname === route;
        return (
          <Pressable
            key={key}
            style={styles.tab}
            onPress={() => {
              if (active) return;
              haptics.selection();
              // Slide in the same direction the tab sits relative to the current one.
              setPendingDir(tabIndex(route) > tabIndex(pathname) ? 1 : -1);
              router.replace(route as never);
            }}
          >
            <View style={[styles.pill, active && styles.pillActive]}>
              <Icon size={20} color={active ? colors.primaryFg : colors.mutedDim} />
            </View>
            <Text style={[styles.label, { color: active ? colors.text : colors.mutedDim }]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: colors.surfaceLowest,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 6,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 4,
    borderRadius: radius.full,
  },
  pillActive: {
    backgroundColor: colors.primary,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
  },
});
