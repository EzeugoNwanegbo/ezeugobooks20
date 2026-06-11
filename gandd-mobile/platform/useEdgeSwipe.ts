import { useWindowDimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "./useHaptics";

// Native Android-style left-edge swipe-back (spec §2/§3). The gesture only
// engages when the touch starts within EDGE px of the left edge, drags the
// whole screen with the finger on the UI thread (no React re-renders), and
// commits `onBack` past a distance/velocity threshold — otherwise springs back.
const EDGE = 32;

export function useEdgeSwipe(onBack: () => void, enabled = true) {
  const { width } = useWindowDimensions();
  const translateX = useSharedValue(0);
  const startX = useSharedValue(0);
  const fromEdge = useSharedValue(false);

  const threshold = width * 0.35;

  const gesture = Gesture.Pan()
    .enabled(enabled)
    .activeOffsetX(16)
    // Let vertical scrolls / sliders win — only horizontal intent activates.
    .failOffsetY([-16, 16])
    .onBegin((e) => {
      startX.value = e.x;
      fromEdge.value = e.x <= EDGE;
    })
    .onUpdate((e) => {
      if (!fromEdge.value) return;
      translateX.value = Math.max(0, e.translationX);
    })
    .onEnd((e) => {
      if (!fromEdge.value) return;
      if (e.translationX > threshold || e.velocityX > 850) {
        runOnJS(haptics.selection)();
        translateX.value = withTiming(
          width,
          { duration: 180, easing: Easing.out(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onBack)();
          },
        );
      } else {
        translateX.value = withTiming(0, { duration: 180, easing: Easing.out(Easing.cubic) });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return { gesture, animatedStyle };
}
