import { router, usePathname } from "expo-router";
import { BookOpen, BrainCircuit, type LucideIcon, MessageSquare, Swords } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius } from "@/lib/theme";
import { haptics } from "./useHaptics";
import { isMainRoute } from "./useBackNavigation";
import { setPendingDir, tabIndex } from "./tab-transition";

export const BOTTOM_NAV_HEIGHT = 62;

// Battle Royale took Last Minute's slot here (2026-08-13) — Last Minute is not
// gone, it moved to the drawer (see platform/Drawer.tsx) and still works
// exactly as before, it just isn't one of the four persistent tabs any more.
const TABS: { key: string; label: string; icon: LucideIcon; route: string; tint?: string }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare, route: "/chat" },
  { key: "library", label: "Library", icon: BookOpen, route: "/library" },
  { key: "coach", label: "Coach", icon: BrainCircuit, route: "/coach" },
  { key: "battle-royale", label: "Battle", icon: Swords, route: "/battle-royale" },
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
      {TABS.map(({ key, label, icon: Icon, route, tint }) => {
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
              <Icon size={20} color={active ? colors.primary : (tint ?? colors.mutedDim)} />
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
    backgroundColor: colors.bg,
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
  // The active tab is a copper TINT with a copper icon, not a solid copper
  // slab. Depth in this system comes from the surface ramp; a filled capsule
  // was the loudest thing on the screen and the site never does that.
  pill: {
    paddingHorizontal: 18,
    paddingVertical: 5,
    borderRadius: radius.sm,
  },
  pillActive: {
    backgroundColor: colors.accentSoft,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
});
