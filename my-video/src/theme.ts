// G&D — Study AI · brand tokens
// Premium / elegant: near-black + champagne, energetic pacing, classy execution.

import { loadFont as loadCormorant } from "@remotion/google-fonts/Cormorant";
import { loadFont as loadPlayfair } from "@remotion/google-fonts/PlayfairDisplay";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Load fonts at module scope so they are ready before render.
const cormorant = loadCormorant("normal", { weights: ["500", "600", "700"] });
const playfair = loadPlayfair("normal", { weights: ["600", "700", "800"] });
const inter = loadInter("normal", { weights: ["400", "500", "600", "700"] });
const mono = loadMono("normal", { weights: ["400", "500"] });

export const fonts = {
  // High-contrast serif for the logo + kinetic headlines (matches the G&D wordmark).
  serif: playfair.fontFamily,
  serifAlt: cormorant.fontFamily,
  // Clean sans for body / UI labels.
  sans: inter.fontFamily,
  // Mono for source citations like `p. 32 · Keith_Moore.pdf`.
  mono: mono.fontFamily,
};

export const colors = {
  bg: "#0A0A0A",
  bgSoft: "#121110",
  champagne: "#C9BCA3",
  champagneDim: "#8C8472",
  cream: "#E8E0CE",
  ink: "#0A0A0A",
  white: "#F5F1E8",
  muted: "#9C968A",
  green: "#22C55E",
  red: "#EF4444",
  border: "rgba(201, 188, 163, 0.28)",
};

// Center safe area — keep key text within ~85% width.
export const SAFE = { width: 918, x: 81 };
