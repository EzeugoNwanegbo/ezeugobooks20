import type { ReactNode } from "react";
import { router } from "expo-router";
import { ChevronLeft, Menu } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandText } from "@/components/ui";
import { colors, fonts } from "@/lib/theme";
import { useEdgeSwipe } from "./useEdgeSwipe";

// Wraps every screen: paints the void background and (when swipeBack is set)
// attaches the left-edge swipe-back gesture that translates the whole screen.
export function ScreenContainer({
  children,
  swipeBack = false,
  onBack,
}: {
  children: ReactNode;
  swipeBack?: boolean;
  onBack?: () => void;
}) {
  const { gesture, animatedStyle } = useEdgeSwipe(onBack ?? (() => router.back()), swipeBack);

  if (!swipeBack) {
    return <View style={styles.root}>{children}</View>;
  }

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.root, animatedStyle]}>{children}</Animated.View>
    </GestureDetector>
  );
}

// Shared top bar. `onMenu` shows a hamburger (main screens); `onBack` shows a
// chevron (secondary screens). `eyebrow` is a small mono label above the title.
export function TopBar({
  title,
  eyebrow,
  onMenu,
  onBack,
  right,
}: {
  title?: string;
  eyebrow?: string;
  onMenu?: () => void;
  onBack?: () => void;
  right?: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
      <View style={styles.barSide}>
        {onBack ? (
          <Pressable hitSlop={10} onPress={onBack} style={styles.iconBtn}>
            <ChevronLeft size={22} color={colors.text} />
          </Pressable>
        ) : onMenu ? (
          <Pressable hitSlop={10} onPress={onMenu} style={styles.iconBtn}>
            <Menu size={22} color={colors.text} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.barCenter}>
        {title ? (
          <View style={{ alignItems: "center" }}>
            {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
          </View>
        ) : (
          <BrandText size={22} />
        )}
      </View>

      <View style={[styles.barSide, { alignItems: "flex-end" }]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  barSide: {
    width: 56,
    justifyContent: "center",
  },
  barCenter: {
    flex: 1,
    alignItems: "center",
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.mutedDim,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  title: {
    fontFamily: fonts.soraSemibold,
    fontSize: 18,
    color: colors.text,
  },
});
