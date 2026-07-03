// Marshal Paints & Chemical Industry — brand tokens.
// Premium: charcoal base, confident red, generous spacing, restrained motion.

import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

// Load at module scope so weights are ready before the first frame renders.
const poppins = loadPoppins("normal", {
  weights: ["400", "500", "600", "700", "800", "900"],
});

export const fonts = {
  // Bold premium sans for headlines, numbers and labels.
  sans: poppins.fontFamily,
};

// EXACT brand palette — do not improvise these values.
export const colors = {
  red: "#E11D23", // primary brand — logo, accents, key words
  charcoal: "#36373B", // primary background — matches brand posters
  yellow: "#FFDA00", // secondary accent / banners
  blue: "#2D5CB8", // secondary accent — Stop Water / MC40 banner
  white: "#FFFFFF",
  offwhite: "#F4F2EE",
  // Derived helpers (kept on-brand).
  charcoalDeep: "#2B2C30",
  charcoalSoft: "#404148",
  redDeep: "#B3151A",
  hairline: "rgba(244, 242, 238, 0.16)",
};

// Composition spec.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1350, // 45s
};

// Center safe area — keep key text within ~85% width.
export const SAFE = { width: 918, x: 81 };
