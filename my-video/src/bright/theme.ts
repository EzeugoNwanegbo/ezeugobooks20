// G&D — Study AI · BRIGHT ad brand tokens.
// Creative rules: warm/vibrant/sunny colours + slow, unhurried pacing.

import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Load fonts at module scope so they are ready before the first frame renders.
const poppins = loadPoppins("normal", { weights: ["500", "600", "700", "800"] });
const inter = loadInter("normal", { weights: ["400", "500", "600"] });
const mono = loadMono("normal", { weights: ["400", "500"] });

export const fonts = {
  // Friendly, rounded, premium display for headlines.
  display: poppins.fontFamily,
  // Clean sans for support copy / UI labels.
  sans: inter.fontFamily,
  // Mono for source citations like `Page 8`.
  mono: mono.fontFamily,
};

export const colors = {
  // Bright, sunny gradient stops (animated slowly in Background).
  bg1: "#FFFCF5",
  bg2: "#FFE9C7",
  bg3: "#FFD2A6",

  // Vivid-but-tasteful accents.
  coral: "#FF6A3D",
  teal: "#12B5B0",
  yellow: "#FFC53D",
  violet: "#7C5CFC",

  // Answer states pulled from the real app UI.
  green: "#22C55E",
  red: "#EF4444",

  // Text — deep charcoal on the light background.
  ink: "#1E1B16",
  inkSoft: "#5A5145",

  // Dark pill that keeps the champagne G&D wordmark legible on a bright bg.
  pill: "#171511",

  // Phone card chrome.
  card: "#FFFFFF",
  cardBorder: "rgba(30, 27, 22, 0.08)",
  cardShadow: "rgba(120, 70, 20, 0.22)",
};

// Composition constants.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1200, // 40s — deliberately slow.
};

// Center safe area — keep key captions within ~88% width.
export const SAFE = { width: 950, x: 65 };

// Standard soft crossfade length between scenes (≈0.7s at 30fps).
export const CROSSFADE = 21;
