// GD1 — "Your Textbook Came Alive" · brand tokens.
// Premium / cinematic: near-black + champagne, fast energetic pacing.
// Everything in this ad is generated in code — no screenshots, no AI clips.

import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Load fonts at module scope so they are ready before the first frame renders.
const playfair = loadPlayfair("normal", { weights: ["600", "700", "800", "900"] });
const inter = loadInter("normal", { weights: ["400", "500", "600", "700", "800"] });
const mono = loadMono("normal", { weights: ["400", "500", "600"] });

export const fonts = {
  // High-contrast serif for the logo + kinetic headlines.
  serif: playfair.fontFamily,
  // Clean sans for body / UI labels.
  sans: inter.fontFamily,
  // Mono for typed prompts and source citations.
  mono: mono.fontFamily,
};

export const colors = {
  bg: "#0A0A0B",
  bgSoft: "#131316",
  panel: "#16161A",
  panelSoft: "#1D1D22",
  champagne: "#D9C8A3",
  champagneDim: "#9C8F73",
  gold: "#E7D6AC",
  cream: "#F3ECDC",
  white: "#F7F4EC",
  muted: "#8E8A82",
  mutedSoft: "#5E5B55",
  green: "#34D399",
  red: "#F87171",
  blue: "#7AA2F7",
  violet: "#9D7CFC",
  border: "rgba(217, 200, 163, 0.22)",
  borderSoft: "rgba(217, 200, 163, 0.12)",
  glow: "rgba(231, 214, 172, 0.55)",
};

// Composition constants — vertical 9:16, fast 42s cut.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1260, // 42s
};

// Center safe area — keep key text within ~86% width.
export const SAFE = { width: 930, x: 75 };

// Standard crossfade length between scenes (~0.5s at 30fps) — kept short & punchy.
export const CROSSFADE = 15;
