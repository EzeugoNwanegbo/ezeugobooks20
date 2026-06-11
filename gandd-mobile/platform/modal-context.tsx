import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "@/lib/theme";
import { haptics } from "./useHaptics";

// A sheet's body is a render function that receives a `close` callback, so the
// content can dismiss itself (e.g. after picking an action).
type SheetRender = (close: () => void) => ReactNode;
type Entry = { id: string; render: SheetRender; closing: boolean };

type ModalContextValue = {
  // Present a bottom sheet; returns its id. Fires a light haptic.
  present: (render: SheetRender) => string;
  // Begin closing a specific sheet (animates out).
  dismiss: (id: string) => void;
  // Begin closing the top-most sheet — used by the hardware back button.
  dismissTop: () => void;
  isAnyOpen: boolean;
};

const ModalContext = createContext<ModalContextValue | null>(null);

let counter = 0;

export function ModalProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);

  const present = useCallback<ModalContextValue["present"]>((render) => {
    const id = `sheet-${++counter}`;
    setEntries((cur) => [...cur, { id, render, closing: false }]);
    haptics.light();
    return id;
  }, []);

  const markClosing = useCallback((id: string) => {
    setEntries((cur) => cur.map((e) => (e.id === id ? { ...e, closing: true } : e)));
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((cur) => cur.filter((e) => e.id !== id));
  }, []);

  const dismissTop = useCallback(() => {
    setEntries((cur) => {
      if (cur.length === 0) return cur;
      const top = cur[cur.length - 1];
      return cur.map((e) => (e.id === top.id ? { ...e, closing: true } : e));
    });
  }, []);

  const value = useMemo<ModalContextValue>(
    () => ({ present, dismiss: markClosing, dismissTop, isAnyOpen: entries.length > 0 }),
    [present, markClosing, dismissTop, entries.length],
  );

  return (
    <ModalContext.Provider value={value}>
      {children}
      {entries.map((entry) => (
        <SheetContainer
          key={entry.id}
          closing={entry.closing}
          onClosed={() => remove(entry.id)}
        >
          {entry.render}
        </SheetContainer>
      ))}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const ctx = useContext(ModalContext);
  if (!ctx) throw new Error("useModal must be used within a ModalProvider");
  return ctx;
}

const HIDDEN = 900;
const ENTER = { duration: 260, easing: Easing.out(Easing.cubic) };
const EXIT = { duration: 200, easing: Easing.in(Easing.cubic) };

function SheetContainer({
  children,
  closing,
  onClosed,
}: {
  children: SheetRender;
  closing: boolean;
  onClosed: () => void;
}) {
  const insets = useSafeAreaInsets();
  const ty = useSharedValue(HIDDEN);
  const height = useSharedValue(HIDDEN);

  const animateClose = useCallback(() => {
    ty.value = withTiming(height.value || HIDDEN, EXIT, (finished) => {
      if (finished) runOnJS(onClosed)();
    });
  }, [ty, height, onClosed]);

  // Slide up on mount.
  useEffect(() => {
    ty.value = withTiming(0, ENTER);
  }, [ty]);

  // Hardware back / programmatic dismiss flips `closing` → animate out.
  useEffect(() => {
    if (closing) animateClose();
  }, [closing, animateClose]);

  const pan = Gesture.Pan()
    .activeOffsetY(10)
    .onUpdate((e) => {
      ty.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 120 || e.velocityY > 800) {
        runOnJS(haptics.selection)();
        runOnJS(animateClose)();
      } else {
        ty.value = withTiming(0, { duration: 160 });
      }
    });

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(ty.value, [0, height.value], [0.6, 0], Extrapolation.CLAMP),
  }));
  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <AnimatedPressable
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        onPress={animateClose}
      />
      <GestureDetector gesture={pan}>
        <Animated.View
          onLayout={(e) => {
            height.value = e.nativeEvent.layout.height;
          }}
          style={[styles.panel, { paddingBottom: insets.bottom + 16 }, panelStyle]}
        >
          <View style={styles.grabber} />
          {children(animateClose)}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000",
  },
  panel: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    marginBottom: 14,
  },
});
