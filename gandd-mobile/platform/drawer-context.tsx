import { createContext, useCallback, useContext, useMemo, useState } from "react";
import {
  Easing,
  runOnJS,
  type SharedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { haptics } from "./useHaptics";

type DrawerContextValue = {
  isOpen: boolean;
  // 0 = fully closed, 1 = fully open. Drives panel translate + backdrop opacity
  // on the UI thread so opening/closing never re-renders the screen behind it.
  progress: SharedValue<number>;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const DrawerContext = createContext<DrawerContextValue | null>(null);

// Viscous, eased motion per the design language (slow, liquid transitions).
const OPEN = { duration: 280, easing: Easing.out(Easing.cubic) };
const CLOSE = { duration: 220, easing: Easing.in(Easing.cubic) };

export function DrawerProvider({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => {
    setIsOpen(true);
    progress.value = withTiming(1, OPEN);
    haptics.light();
  }, [progress]);

  const close = useCallback(() => {
    progress.value = withTiming(0, CLOSE, (finished) => {
      if (finished) runOnJS(setIsOpen)(false);
    });
    haptics.light();
  }, [progress]);

  const toggle = useCallback(() => {
    if (isOpen) close();
    else open();
  }, [isOpen, open, close]);

  const value = useMemo(
    () => ({ isOpen, progress, open, close, toggle }),
    [isOpen, progress, open, close, toggle],
  );

  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

export function useDrawer() {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error("useDrawer must be used within a DrawerProvider");
  return ctx;
}
