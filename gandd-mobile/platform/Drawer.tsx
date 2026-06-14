import { router } from "expo-router";
import { Clock, Heart, type LucideIcon, LogOut, Settings } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandText } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { colors, fonts, radius } from "@/lib/theme";
import { useDrawer } from "./drawer-context";
import { useDrawerGestures } from "./useDrawerGestures";

export const DRAWER_WIDTH = 304;
const WIDTH = DRAWER_WIDTH;

const ITEMS: { label: string; icon: LucideIcon; route: string }[] = [
  { label: "History", icon: Clock, route: "/history" },
  { label: "Settings", icon: Settings, route: "/settings" },
  { label: "Feedback", icon: Heart, route: "/feedback" },
];

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Overlay drawer (spec §1): content stays visible behind it (not push layout).
// Opens via hamburger; closes via swipe-left (useDrawerGestures), backdrop tap,
// or the Android back button (useBackNavigation). Always mounted so it can
// animate; pointer events disabled while closed.
export function Drawer() {
  const { isOpen, close } = useDrawer();
  const { gesture, backdropStyle, panelStyle } = useDrawerGestures(WIDTH);
  const insets = useSafeAreaInsets();
  const { user, profile, signOut } = useAuth();

  const go = (route: string) => {
    close();
    // Let the close animation start before the push.
    setTimeout(() => router.push(route as never), 60);
  };

  const onSignOut = () => {
    close();
    setTimeout(() => void signOut(), 60);
  };

  const name = profile?.name?.trim() || user?.email?.split("@")[0] || "Student";

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={isOpen ? "auto" : "none"}
    >
      <AnimatedPressable
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        onPress={close}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.panel,
            { width: WIDTH, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 20 },
            panelStyle,
          ]}
        >
          <BrandText size={26} />

          <View style={styles.account}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountName} numberOfLines={1}>
                {name}
              </Text>
              {user?.email ? (
                <Text style={styles.accountEmail} numberOfLines={1}>
                  {user.email}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.items}>
            {ITEMS.map(({ label, icon: Icon, route }) => (
              <Pressable
                key={route}
                onPress={() => go(route)}
                style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
              >
                <Icon size={20} color={colors.muted} />
                <Text style={styles.itemLabel}>{label}</Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            onPress={onSignOut}
            style={({ pressed }) => [styles.signOut, pressed && styles.itemPressed]}
          >
            <LogOut size={20} color={colors.danger} />
            <Text style={[styles.itemLabel, { color: colors.danger }]}>Sign out</Text>
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceLowest,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: 20,
  },
  account: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 28,
    marginBottom: 28,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontFamily: fonts.soraSemibold,
    fontSize: 18,
    color: colors.primaryFg,
  },
  accountName: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.text,
  },
  accountEmail: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedDim,
    marginTop: 1,
  },
  items: {
    flex: 1,
    gap: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.full,
  },
  itemPressed: {
    backgroundColor: colors.tint,
  },
  itemLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.full,
  },
});
