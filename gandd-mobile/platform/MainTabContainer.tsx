import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import { router, usePathname } from "expo-router";
import { StyleSheet, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/lib/theme";
import { DRAWER_WIDTH } from "./Drawer";
import { useDrawer } from "./drawer-context";
import { haptics } from "./useHaptics";
import { consumePendingDir, setPendingDir, TAB_ROUTES, tabIndex } from "./tab-transition";

// Left-edge zone reserved for the drawer-open drag; swipes that start further in
// move between tabs instead. Keep it narrow so it doesn't eat normal swipes.
const EDGE = 28;

// Root wrapper for the four main tab screens (Chat / Library / Links / Coach).
// Provides two finger gestures on the UI thread:
//   • drag right from the left edge  → slides the drawer open (spec: swipe menu)
//   • horizontal swipe anywhere else → moves to the next/previous tab, sliding
//     the incoming screen in from the side it came from.
// Vertical intent (failOffsetY) yields to the screen's ScrollView.
export function MainTabContainer({
  children,
  swipeEnabled = true,
}: {
  children: ReactNode;
  swipeEnabled?: boolean;
}) {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const { progress, open, close, isOpen } = useDrawer();

  const index = tabIndex(pathname);
  const lastIndex = TAB_ROUTES.length - 1;

  // Consume the navigation direction exactly once on this instance's first
  // render (a bare useRef(consumePendingDir()) would re-call it every render and
  // could swallow a direction meant for another screen). 0 = no slide.
  const enterDirRef = useRef<-1 | 0 | 1 | null>(null);
  if (enterDirRef.current === null) enterDirRef.current = consumePendingDir();
  const enterDir = enterDirRef.current;
  const tx = useSharedValue(enterDir * width);
  useEffect(() => {
    if (enterDir !== 0) {
      tx.value = withTiming(0, { duration: 240, easing: Easing.out(Easing.cubic) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Whether the active pan started in the drawer-open edge zone.
  const fromEdge = useSharedValue(false);

  const navigate = (i: number, dir: -1 | 1) => {
    haptics.selection();
    setPendingDir(dir);
    router.replace(TAB_ROUTES[i] as never);
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15])
    .failOffsetY([-14, 14])
    .onBegin((e) => {
      fromEdge.value = e.x <= EDGE && !isOpen;
    })
    .onUpdate((e) => {
      if (fromEdge.value) {
        // Drag the drawer open with the finger (0 = closed, 1 = open).
        progress.value = Math.max(0, Math.min(1, e.translationX / DRAWER_WIDTH));
        return;
      }
      // Follow the finger; add resistance at the two ends of the tab row.
      let dx = e.translationX;
      if ((index === 0 && dx > 0) || (index === lastIndex && dx < 0)) dx *= 0.3;
      tx.value = dx;
    })
    .onEnd((e) => {
      if (fromEdge.value) {
        if (e.translationX > DRAWER_WIDTH * 0.4 || e.velocityX > 600) runOnJS(open)();
        else runOnJS(close)();
        return;
      }
      const threshold = width * 0.3;
      const goNext = (e.translationX < -threshold || e.velocityX < -750) && index < lastIndex;
      const goPrev = (e.translationX > threshold || e.velocityX > 750) && index > 0;
      if (goNext) {
        tx.value = withTiming(-width, { duration: 160, easing: Easing.out(Easing.cubic) });
        runOnJS(navigate)(index + 1, 1);
      } else if (goPrev) {
        tx.value = withTiming(width, { duration: 160, easing: Easing.out(Easing.cubic) });
        runOnJS(navigate)(index - 1, -1);
      } else {
        tx.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    });

  const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  // Chat turns the swipe off so the tab-swipe pan doesn't steal the horizontal
  // drag that native text selection needs. Tabs are still reachable via the bar.
  if (!swipeEnabled) {
    return <Animated.View style={[styles.root, style]}>{children}</Animated.View>;
  }

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.root, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
});
