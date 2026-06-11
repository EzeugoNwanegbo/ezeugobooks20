import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { colors, fonts, radius } from "@/lib/theme";

export function BrandText({ size = 22, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <Text
      style={{
        color: dim ? colors.muted : colors.text,
        fontSize: size,
        fontFamily: fonts.soraBold,
        letterSpacing: 0.5,
      }}
    >
      G&amp;D
    </Text>
  );
}

export function Card({
  children,
  style,
}: {
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  label,
  onPress,
  variant = "primary",
  loading = false,
  disabled = false,
  icon,
  full = true,
  style,
}: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  full?: boolean;
  style?: ViewStyle;
}) {
  const isDisabled = disabled || loading;
  const palette = BUTTON_PALETTE[variant];
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.button,
        full && { alignSelf: "stretch" },
        {
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderWidth: palette.border ? 1 : 0,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={palette.fg} /> : icon}
      <Text style={[styles.buttonLabel, { color: palette.fg }]}>{label}</Text>
    </Pressable>
  );
}

const BUTTON_PALETTE: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
  primary: { bg: colors.primary, fg: colors.primaryFg },
  secondary: { bg: "transparent", fg: colors.text, border: colors.borderStrong },
  ghost: { bg: "transparent", fg: colors.muted },
  danger: { bg: colors.dangerSoft, fg: colors.danger, border: colors.danger },
};

export function Field({
  label,
  style,
  ...props
}: TextInputProps & { label?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.mutedDim}
        style={[styles.input, props.multiline && styles.inputMultiline, style]}
        {...props}
      />
    </View>
  );
}

// Small fully-rounded segmented control item (chat mode tabs).
export function Chip({
  label,
  active,
  onPress,
  style,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipIdle, style]}
    >
      <Text style={[styles.chipLabel, { color: active ? colors.primaryFg : colors.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Tiny mono capsule used as a status marker (INDEXED, PDF, COMPLETED…).
export function Tag({
  label,
  tone = "neutral",
  style,
}: {
  label: string;
  tone?: "neutral" | "solid" | "success" | "warning";
  style?: ViewStyle;
}) {
  const t = TAG_TONE[tone];
  return (
    <View style={[styles.tag, { backgroundColor: t.bg, borderColor: t.border }, style]}>
      <Text style={[styles.tagLabel, { color: t.fg }]}>{label}</Text>
    </View>
  );
}

const TAG_TONE = {
  neutral: { bg: colors.tint, border: colors.border, fg: colors.muted },
  solid: { bg: colors.primary, border: colors.primary, fg: colors.primaryFg },
  success: { bg: "rgba(143,209,158,0.14)", border: "rgba(143,209,158,0.4)", fg: colors.success },
  warning: { bg: colors.warningSoft, border: "rgba(224,176,74,0.4)", fg: colors.warning },
} as const;

export function ProgressBar({ value, style }: { value: number; style?: ViewStyle }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View style={[styles.progressTrack, style]}>
      <View style={[styles.progressFill, { width: `${pct}%` }]} />
    </View>
  );
}

// Mono uppercase eyebrow used above section headers.
export function Eyebrow({ children, style }: { children: ReactNode; style?: TextStyle }) {
  return <Text style={[styles.eyebrow, style]}>{children}</Text>;
}

export function SectionTitle({ icon, title }: { icon?: ReactNode; title: string }) {
  return (
    <View style={styles.sectionTitle}>
      {icon}
      <Text style={styles.sectionTitleText}>{title}</Text>
    </View>
  );
}

export function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
  },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.full,
    paddingVertical: 15,
    paddingHorizontal: 20,
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: fonts.bodySemibold,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontFamily: fonts.bodyMedium,
  },
  input: {
    backgroundColor: colors.surfaceLowest,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.full,
    paddingHorizontal: 18,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  inputMultiline: {
    minHeight: 120,
    borderRadius: radius.lg,
    textAlignVertical: "top",
  },
  chip: {
    flex: 1,
    borderRadius: radius.full,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: colors.primary,
  },
  chipIdle: {
    backgroundColor: "transparent",
  },
  chipLabel: {
    fontSize: 11,
    fontFamily: fonts.mono,
    letterSpacing: 0.3,
  },
  tag: {
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
    alignSelf: "flex-start",
  },
  tagLabel: {
    fontSize: 9.5,
    fontFamily: fonts.mono,
    letterSpacing: 0.6,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.tint,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.accent,
  },
  eyebrow: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    letterSpacing: 1.2,
    color: colors.mutedDim,
    textTransform: "uppercase",
  },
  sectionTitle: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  sectionTitleText: {
    color: colors.text,
    fontSize: 16,
    fontFamily: fonts.soraSemibold,
  },
  empty: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    paddingVertical: 32,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    textAlign: "center",
    fontFamily: fonts.body,
  },
});
