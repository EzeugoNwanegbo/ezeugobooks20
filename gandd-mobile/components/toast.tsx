import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, radius } from "@/lib/theme";

type ToastKind = "success" | "error" | "info";
type ToastMsg = { id: number; kind: ToastKind; text: string };

// Module-level dispatcher so non-component code (clients, async handlers) can
// raise toasts the same way the web app calls sonner's `toast`.
let externalPush: ((kind: ToastKind, text: string) => void) | null = null;

export const toast = {
  success: (text: string) => externalPush?.("success", text),
  error: (text: string) => externalPush?.("error", text),
  message: (text: string) => externalPush?.("info", text),
};

const KIND_COLOR: Record<ToastKind, string> = {
  success: colors.success,
  error: colors.danger,
  info: colors.accent,
};

export function ToastHost() {
  const [items, setItems] = useState<ToastMsg[]>([]);
  const idRef = useRef(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    externalPush = (kind, text) => {
      const id = ++idRef.current;
      setItems((cur) => [...cur.slice(-2), { id, kind, text }]);
      setTimeout(() => setItems((cur) => cur.filter((t) => t.id !== id)), 3400);
    };
    return () => {
      externalPush = null;
    };
  }, []);

  if (items.length === 0) return null;

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 16 }]}>
      {items.map((item) => (
        <View key={item.id} style={styles.toast}>
          <View style={[styles.dot, { backgroundColor: KIND_COLOR[item.kind] }]} />
          <Text style={styles.text}>{item.text}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 16,
    right: 16,
    gap: 8,
    alignItems: "center",
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 460,
    width: "100%",
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 12,
    paddingHorizontal: 14,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  text: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontWeight: "500",
  },
});
