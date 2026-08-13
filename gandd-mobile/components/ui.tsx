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
import { colors, font, fonts, layout, radius } from "@/lib/theme";

// The one protected mark. Varsity is reserved for this and nothing else — no
// heading or label may borrow it (same rule as --font-wordmark on the web).
export function BrandText({ size = 24, dim = false }: { size?: number; dim?: boolean }) {
  return (
    <Text
      style={{
        color: dim ? colors.muted : colors.text,
        fontSize: size,
        fontFamily: fonts.wordmark,
        letterSpacing: font.brandLetterSpacing,
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

// There is no green in the palette — "success" is the lifted copper (--leaf),
// the same tone the site uses for "answered from your own files".
const TAG_TONE = {
  neutral: { bg: colors.tint, border: colors.border, fg: colors.muted },
  solid: { bg: colors.primary, border: colors.primary, fg: colors.primaryFg },
  success: { bg: colors.successSoft, border: "rgba(198,169,127,0.4)", fg: colors.success },
  warning: { bg: colors.warningSoft, border: "rgba(196,145,94,0.4)", fg: colors.warning },
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

// A row of preset-number pills plus a "Custom" pill that swaps in a numeric
// field. Built for My Coach's question-count and timer-duration pickers
// (both are "pick a number, or type your own"), but kept generic — string
// props for the label, unit suffix and copy so a later screen (Battle Royale
// timers, say) can reuse it without forking the markup.
export function PresetOrCustom({
  options,
  isCustom,
  activeValue,
  customText,
  onPreset,
  onCustom,
  onCustomText,
  suffix = "",
  placeholder,
  error,
  hint,
}: {
  /** The preset numbers, shown as pills in order. */
  options: readonly number[];
  /** True once the student has switched to the free-typed field. */
  isCustom: boolean;
  /** The preset currently in effect, so its pill can highlight — ignored while isCustom. */
  activeValue: number;
  /** Raw typed text while isCustom (kept as a string so a mid-edit "" or "-" doesn't get coerced away). */
  customText: string;
  onPreset: (value: number) => void;
  onCustom: () => void;
  onCustomText: (text: string) => void;
  /** Appended to each preset pill's label, e.g. " min". */
  suffix?: string;
  placeholder?: string;
  /** Validation message shown under the field; replaces `hint` when present. */
  error?: string | null;
  /** Quiet copy shown under the field when there's no error (the accepted range). */
  hint?: string;
}) {
  return (
    <View>
      <View style={styles.pocRow}>
        {options.map((option) => {
          const active = !isCustom && activeValue === option;
          return (
            <Pressable
              key={option}
              onPress={() => onPreset(option)}
              style={[styles.pocPill, active ? styles.pocPillActive : styles.pocPillIdle]}
            >
              <Text style={[styles.pocPillLabel, { color: active ? colors.primaryFg : colors.muted }]}>
                {option}
                {suffix}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={onCustom}
          style={[styles.pocPill, isCustom ? styles.pocPillActive : styles.pocPillIdle]}
        >
          <Text style={[styles.pocPillLabel, { color: isCustom ? colors.primaryFg : colors.muted }]}>
            Custom
          </Text>
        </Pressable>
      </View>
      {isCustom ? (
        <View style={{ marginTop: 8 }}>
          <TextInput
            value={customText}
            onChangeText={onCustomText}
            placeholder={placeholder}
            placeholderTextColor={colors.mutedDim}
            keyboardType="number-pad"
            style={styles.pocInput}
          />
          {error ? (
            <Text style={styles.pocError}>{error}</Text>
          ) : hint ? (
            <Text style={styles.pocHint}>{hint}</Text>
          ) : null}
        </View>
      ) : null}
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
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 18,
    // Card is only used for the auth/onboarding forms today. Capping and
    // centering it here keeps those single-column forms from stretching
    // edge-to-edge into unreadable full-width rows on a tablet or unfolded
    // foldable (supportsTablet is on for iOS in app.json); phones are all
    // narrower than the cap so this is a no-op there.
    width: "100%",
    maxWidth: layout.formMaxWidth,
    alignSelf: "center",
  },
  // Keyed plate, not a pill. The site's buttons are rounded-md off a 14px
  // --radius; a 999px capsule is the one shape the design system rules out.
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.md,
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
  // Fields carry a stronger edge than plain borders: minimalism removed the
  // shadows that used to hint where a control was, so the outline has to
  // actually be visible (--input is 0.26 Bone against --border's 0.14).
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.input,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.body,
  },
  inputMultiline: {
    minHeight: 120,
    borderRadius: radius.md,
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
  pocRow: { flexDirection: "row", gap: 8 },
  pocPill: { flex: 1, borderRadius: radius.full, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  pocPillActive: { borderColor: colors.primary, backgroundColor: colors.primary },
  pocPillIdle: { borderColor: colors.border, backgroundColor: "transparent" },
  pocPillLabel: { fontSize: 12.5, fontFamily: fonts.bodySemibold },
  pocInput: {
    backgroundColor: colors.surface,
    borderColor: colors.input,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.mono,
  },
  pocError: { color: colors.danger, fontSize: 11.5, marginTop: 6, fontFamily: fonts.body },
  pocHint: { color: colors.mutedDim, fontSize: 11.5, marginTop: 6, fontFamily: fonts.body },
});
