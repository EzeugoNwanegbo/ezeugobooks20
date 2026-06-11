// Central design tokens for the native G&D app.
// Design language: "Symbiote Organicism" (see stitch/symbiote_organicism/DESIGN.md):
// a deep absolute-black void with a warm beige "vital spark", pill-shaped surfaces,
// and architectural typography (Sora / Hanken Grotesk / JetBrains Mono).
export const colors = {
  // Void + tonal surface ladder (depth via lighter blacks, not shadows).
  bg: "#131313",
  surfaceLowest: "#0e0e0e",
  surface: "#1c1b1b",
  surfaceElevated: "#2a2a2a",
  surfaceBright: "#393939",
  card: "#20201f",
  border: "#47473f",
  borderStrong: "#5e5d52",
  // Text: warm bone-white that vibrates against the black.
  text: "#e5e2e1",
  muted: "#c8c7bc",
  mutedDim: "#929187",
  // Warm beige is the primary action colour (black text sits on it).
  primary: "#e4e4cc",
  primaryDim: "#c8c8b0",
  primaryFg: "#1b1d0e",
  // Accent mirrors the beige spark so active icons/labels glow.
  accent: "#e4e4cc",
  accentSoft: "rgba(228, 228, 204, 0.12)",
  // Secondary (ghost / chip) tones.
  secondary: "#4a4949",
  onSecondary: "#bab8b7",
  tint: "rgba(229, 226, 225, 0.08)",
  tintStrong: "rgba(229, 226, 225, 0.14)",
  danger: "#ffb4ab",
  dangerSoft: "rgba(255, 180, 171, 0.12)",
  success: "#8fd19e",
  warning: "#e0b04a",
  warningSoft: "rgba(224, 176, 74, 0.12)",
} as const;

// Pill-shaped everywhere — the shape language forbids hard rectangles.
export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  xl: 32,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

// Loaded in app/_layout.tsx via @expo-google-fonts; values are the family names
// react-native resolves once the fonts are registered.
export const fonts = {
  soraMedium: "Sora_500Medium",
  soraSemibold: "Sora_600SemiBold",
  soraBold: "Sora_700Bold",
  body: "HankenGrotesk_400Regular",
  bodyMedium: "HankenGrotesk_500Medium",
  bodySemibold: "HankenGrotesk_600SemiBold",
  mono: "JetBrainsMono_500Medium",
  monoRegular: "JetBrainsMono_400Regular",
} as const;

export const font = {
  brandLetterSpacing: 2,
} as const;
