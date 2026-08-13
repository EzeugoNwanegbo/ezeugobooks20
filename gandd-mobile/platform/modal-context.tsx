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
import { Keyboard, Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
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
  const { height: winHeight } = useWindowDimensions();
  const ty = useSharedValue(HIDDEN);
  const height = useSharedValue(HIDDEN);
  // How far to lift the sheet so the keyboard doesn't cover it. Driven by JS
  // Keyboard events, which fire reliably in Expo Go / edge-to-edge Android where
  // Reanimated's useAnimatedKeyboard reports nothing. The panel already pads its
  // bottom by the safe-area inset, so we reuse that as the gap above the keyboard.
  const lift = useSharedValue(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => {
      const h = e.endCoordinates?.height ?? 0;
      lift.value = withTiming(Math.max(0, h - insets.bottom), { duration: 220 });
    });
    const hide = Keyboard.addListener(hideEvt, () => {
      lift.value = withTiming(0, { duration: 180 });
    });
    // The sheet can be presented while the keyboard is ALREADY up (e.g. tapping
    // "attach" mid-typing) — no show event fires then, so seed the lift from the
    // current keyboard state instead of waiting for one.
    const current = Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0;
    if (current > 0) {
      lift.value = withTiming(Math.max(0, current - insets.bottom), { duration: 220 });
    }
    return () => {
      show.remove();
      hide.remove();
    };
  }, [lift, insets.bottom]);

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
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: ty.value - lift.value }],
  }));

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
          style={[
            styles.panel,
            {
              paddingBottom: insets.bottom + 16,
              // Never let a tall sheet (long doc list, long lookup answer)
              // run off the TOP of a short device — leave room for the status
              // bar/notch. Individual sheets cap their own scrollable list
              // sections; this is the backstop for the sheet as a whole.
              maxHeight: winHeight - insets.top - 24,
            },
            panelStyle,
          ]}
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
    // Pairs with the maxHeight set inline: without this, content taller than
    // the cap doesn't scroll away, it just paints past the panel's box (up
    // through the status bar on a short device) since RN's default overflow
    // is visible.
    overflow: "hidden",
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
