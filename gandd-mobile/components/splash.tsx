import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { colors, fonts } from "@/lib/theme";

// Loading screen: the G&D wordmark rises in letter-by-letter and stays fully
// legible, with a single slim beige bar sweeping underneath. Cool but minimal —
// the name is the hero. Reanimated, UI-thread.

const CHARS = ["G", "&", "D"];
const TRACK_W = 150;
const HL_W = 52;

// One wordmark letter that fades and floats up, staggered by its index.
function Char({ char, index }: { char: string; index: number }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = withDelay(
      index * 140,
      withTiming(1, { duration: 540, easing: Easing.out(Easing.cubic) }),
    );
    return () => cancelAnimation(p);
  }, [index, p]);

  const style = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: [{ translateY: (1 - p.value) * 18 }],
  }));

  return <Animated.Text style={[styles.char, style]}>{char}</Animated.Text>;
}

export function Splash({ subtitle }: { subtitle?: string }) {
  const sweep = useSharedValue(0);
  const breathe = useSharedValue(0);

  useEffect(() => {
    sweep.value = withRepeat(
      withTiming(1, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      false,
    );
    // Start the gentle breath only after the letters have arrived.
    breathe.value = withDelay(
      520,
      withRepeat(withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
    return () => {
      cancelAnimation(sweep);
      cancelAnimation(breathe);
    };
  }, [sweep, breathe]);

  const wordStyle = useAnimatedStyle(() => ({ transform: [{ scale: 1 + breathe.value * 0.02 }] }));
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -HL_W + sweep.value * (TRACK_W + HL_W) }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({ opacity: 0.45 + breathe.value * 0.45 }));

  return (
    <View style={styles.root}>
      <Animated.View style={[styles.word, wordStyle]}>
        {CHARS.map((c, i) => (
          <Char key={i} char={c} index={i} />
        ))}
      </Animated.View>

      <View style={styles.track}>
        <Animated.View style={[styles.highlight, highlightStyle]} />
      </View>

      {subtitle ? (
        <Animated.Text style={[styles.subtitle, subtitleStyle]}>{subtitle}</Animated.Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  word: {
    flexDirection: "row",
    alignItems: "center",
  },
  char: {
    color: colors.text,
    fontFamily: fonts.soraBold,
    fontSize: 58,
    letterSpacing: 1,
  },
  track: {
    width: TRACK_W,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.tint,
    overflow: "hidden",
    marginTop: 36,
  },
  highlight: {
    position: "absolute",
    height: 4,
    width: HL_W,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  subtitle: {
    marginTop: 18,
    color: colors.mutedDim,
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    textAlign: "center",
  },
});
