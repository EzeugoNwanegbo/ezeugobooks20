import { Gesture } from "react-native-gesture-handler";
import {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";
import { useDrawer } from "./drawer-context";

// Drives the drawer panel + backdrop from the shared `progress` value and
// provides a pan-to-close gesture (drag the panel left). Opening is via the
// hamburger only (spec §1) so the left edge stays reserved for swipe-back.
export function useDrawerGestures(width: number) {
  const { progress, close } = useDrawer();

  const gesture = Gesture.Pan()
    .activeOffsetX([-12, 12])
    .onUpdate((e) => {
      // Dragging left (negative) reduces progress toward 0.
      const next = 1 + Math.min(0, e.translationX) / width;
      progress.value = Math.max(0, Math.min(1, next));
    })
    .onEnd((e) => {
      if (e.translationX < -width * 0.3 || e.velocityX < -650) {
        runOnJS(close)();
      } else {
        progress.value = withTiming(1, { duration: 180 });
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: progress.value * 0.6,
  }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateX: interpolate(
          progress.value,
          [0, 1],
          [-width, 0],
          Extrapolation.CLAMP,
        ),
      },
    ],
  }));

  return { gesture, backdropStyle, panelStyle };
}
