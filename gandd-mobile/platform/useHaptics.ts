import * as Haptics from "expo-haptics";
import { IS_NATIVE } from "./useIsNative";

// Single source of truth for vibration feedback. Kept deliberately light so it
// feels native and not annoying (spec §6). Exposed both as a plain object (so
// gesture worklets can call it via runOnJS, and non-component code can use it)
// and via the useHaptics() hook for components.
export const haptics = {
  light() {
    if (IS_NATIVE) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  },
  medium() {
    if (IS_NATIVE) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  },
  selection() {
    if (IS_NATIVE) void Haptics.selectionAsync();
  },
  success() {
    if (IS_NATIVE) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  },
};

export function useHaptics() {
  return haptics;
}
