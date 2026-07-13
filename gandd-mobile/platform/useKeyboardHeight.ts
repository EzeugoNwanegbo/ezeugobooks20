import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

// Current on-screen keyboard height (0 when hidden). Driven by JS Keyboard
// events, which fire reliably in Expo Go / edge-to-edge Android where
// Reanimated's useAnimatedKeyboard reports nothing — the same approach the modal
// sheets use. Lift an input area by this to keep it above the keyboard.
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(() =>
    Keyboard.isVisible() ? (Keyboard.metrics()?.height ?? 0) : 0,
  );

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, (e) => setHeight(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(hideEvt, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
