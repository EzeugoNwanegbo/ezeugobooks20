import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors } from "@/lib/theme";

// The AI marker: a black "symbiote" orb with a white core that wobbles and morphs
// its edges organically (venom-like) instead of a static sparkle icon. The four
// corner radii are driven by out-of-phase sine waves, with a little rotation and
// squash, so the blob never settles into a clean circle. Reanimated, UI-thread.
export function SymbioteOrb({ size = 16 }: { size?: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(t);
  }, [t]);

  const blobStyle = useAnimatedStyle(() => {
    const k = t.value * Math.PI * 2;
    const base = 0.5;
    const amp = 0.26;
    return {
      borderTopLeftRadius: size * (base + amp * Math.sin(k)),
      borderTopRightRadius: size * (base + amp * Math.sin(k + 1.7)),
      borderBottomRightRadius: size * (base + amp * Math.sin(k + 3.2)),
      borderBottomLeftRadius: size * (base + amp * Math.sin(k + 4.6)),
      transform: [
        { rotate: `${Math.sin(k) * 10}deg` },
        { scaleX: 1 + 0.07 * Math.sin(k + 0.8) },
        { scaleY: 1 + 0.07 * Math.cos(k) },
      ],
    };
  });

  const core = Math.max(3, size * 0.34);

  return (
    <Animated.View style={[{ width: size, height: size }, styles.blob, blobStyle]}>
      <View style={{ width: core, height: core, borderRadius: 999, backgroundColor: colors.text }} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  blob: {
    backgroundColor: "#000",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
