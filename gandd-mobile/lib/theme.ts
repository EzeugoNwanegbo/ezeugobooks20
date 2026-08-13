// Central design tokens for the native G&D app.
//
// These are THE SAME FIVE the website runs on — see the ":root" block in
// src/styles.css. The old "Symbiote Organicism" beige/pill language is gone:
// the app and the site are one product and must not read as two.
//
//   Black        #070707  page ground
//   Graphite     #2D2D2D  elevated surfaces, plates, the side menu
//   Bone         #E9E0D1  primary ink            (18:1 on Black)
//   Pale Oak     #D5C9AE  muted / secondary ink  (14:1 on Black)
//   Faded Copper #A58763  THE accent             (6.5:1 on Black)
//
// Depth is a ramp between the first two, never a shadow or a glow.
export const colors = {
  // Ground + the Black → Graphite ramp (~25%, ~45%, ~55%).
  bg: "#070707",
  surfaceLowest: "#050505",
  surface: "#131211",
  surfaceElevated: "#1e1d1b",
  surfaceBright: "#2d2d2d",

  // `card` is the web's 4% Bone tint, correct on an opaque parent.
  card: "rgba(233, 224, 209, 0.04)",
  // `panel` is that tint already resolved against the page as an OPAQUE colour.
  // Anything that FLOATS (sheet, modal, drawer, popover) must use this, never
  // `card` — a 4% tint over a chat transcript is a see-through dialog. This is
  // the same bug the website hit and fixed at the token.
  panel: "#10100f",
  popover: "#1a1918",

  // Borders are ALPHA Bone, so one token reads correctly on the page and on a
  // raised plate alike. Fields carry a stronger edge than plain borders.
  border: "rgba(233, 224, 209, 0.14)",
  borderStrong: "rgba(233, 224, 209, 0.18)",
  input: "rgba(233, 224, 209, 0.26)",

  // Ink.
  text: "#e9e0d1",
  muted: "#a79c88",
  mutedDim: "#918876",
  faint: "#867d6c",

  // Faded Copper is the primary action; ink on it is near-Black at 6.0:1.
  primary: "#a58763",
  primaryDim: "#957a5b",
  primaryGlow: "#c2a17a",
  primaryFg: "#0e0b08",

  // One accent for everyone (discipline colour is retired on the web).
  accent: "#a58763",
  accentSoft: "rgba(165, 135, 99, 0.12)",
  accentStrong: "rgba(165, 135, 99, 0.22)",

  // Quiet secondary surface.
  secondary: "#1a1918",
  onSecondary: "#e9e0d1",

  tint: "rgba(233, 224, 209, 0.04)",
  tintStrong: "rgba(233, 224, 209, 0.08)",

  // The ONE colour outside the palette: irreversible actions. Hue ~6° against
  // copper's ~33°, roughly twice the saturation, so it can never be mistaken
  // for a primary action.
  danger: "#d0685b",
  dangerSoft: "rgba(208, 104, 91, 0.12)",
  dangerFg: "#150c09",

  // Warm "hurry" tone — inside the family, pushed amber. 7.2:1.
  warning: "#c4915e",
  warningSoft: "rgba(196, 145, 94, 0.12)",

  // There is no green in the palette; "success" is the lifted copper.
  success: "#c6a97f",
  successSoft: "rgba(198, 169, 127, 0.12)",

  // Source badges — copper for "your own material", then two steps of oak.
  sourceLibrary: "#c2a17a",
  sourceGeneral: "#d5c9ae",
  sourceWeb: "#8e8574",
  // Signals "answered from your own files".
  leaf: "#c6a97f",

  // Selection is a copper role; Bone on it is still 10.3:1.
  selection: "rgba(165, 135, 99, 0.3)",
  // Chat background aura: copper blooming, settling into Graphite at the edge.
  auraCore: "rgba(165, 135, 99, 0.06)",
  auraEdge: "rgba(45, 45, 45, 0.5)",
} as const;

// THE KEYED PLATE. The website's --radius is 0.875rem (14px) and its scale is
// built off that; pills are gone everywhere except genuine capsules (tags,
// avatars, progress tracks), which is what `full` is now reserved for.
export const radius = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 22,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

// ONE VOICE, TWO JOBS. A reference plate is set in a single workhorse face;
// what varies is size, weight and measure, never the family. Four families
// competing is what made the product read like a toy, so Sora is retired —
// headings, body and answers are all Hanken Grotesk. JetBrains Mono carries
// plate numerals, source keys and measurements. Varsity is the wordmark and
// NOTHING else may borrow it.
export const fonts = {
  // Display / headings (was Sora — kept under the same keys so callers that
  // still ask for `soraBold` get the correct face instead of breaking).
  display: "HankenGrotesk_600SemiBold",
  displayBold: "HankenGrotesk_700Bold",
  soraMedium: "HankenGrotesk_500Medium",
  soraSemibold: "HankenGrotesk_600SemiBold",
  soraBold: "HankenGrotesk_700Bold",

  body: "HankenGrotesk_400Regular",
  bodyMedium: "HankenGrotesk_500Medium",
  bodySemibold: "HankenGrotesk_600SemiBold",
  bodyBold: "HankenGrotesk_700Bold",

  mono: "JetBrainsMono_500Medium",
  monoRegular: "JetBrainsMono_400Regular",

  // The G&D mark only.
  wordmark: "Varsity",
} as const;

export const font = {
  // The wordmark is set tight on the web (-0.02em), not tracked out.
  brandLetterSpacing: -0.5,
  // Mono eyebrows / nav labels: 0.12em at 10px.
  eyebrowLetterSpacing: 1.2,
} as const;

// ONE SOURCE OF TRUTH for responsive breakpoints/measures, so screens don't
// sprinkle their own magic numbers next to ad-hoc Dimensions.get() calls.
// `formMaxWidth` keeps single-column sign-up/onboarding cards from stretching
// into an absurd full-bleed line of text on a tablet or unfolded foldable
// (app.json sets supportsTablet on iOS, and 600dp+ Android tablets exist too).
export const layout = {
  formMaxWidth: 480,
  // Below this width is the small/budget Android hard case (360dp, and 320dp
  // narrower still) — the device range this app's market actually ships on.
  narrowWidth: 360,
  // 600dp+ is where a single centered column starts reading as underbuilt
  // rather than intentional (tablets, unfolded foldables).
  wideWidth: 600,
} as const;
