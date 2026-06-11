import { Platform } from "react-native";

// True on real devices / emulators (Android & iOS), false on the web export.
// All mobile-only behaviour (gestures, haptics, hardware back) gates on this.
export const IS_NATIVE = Platform.OS === "android" || Platform.OS === "ios";

export function useIsNative() {
  return IS_NATIVE;
}
