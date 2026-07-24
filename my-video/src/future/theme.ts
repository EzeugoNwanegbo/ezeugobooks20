import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadSora } from "@remotion/google-fonts/Sora";

const inter = loadInter("normal", { weights: ["400", "500", "600", "700"] });
const sora = loadSora("normal", { weights: ["400", "500", "600", "700"] });

export const fonts = {
  sans: inter.fontFamily,
  display: sora.fontFamily,
};

export const colors = {
  black: "#030712",
  ink: "#F8FAFC",
  muted: "rgba(248,250,252,0.68)",
  blue: "#2563EB",
  orange: "#F97316",
  gold: "#FACC15",
  glass: "rgba(15,23,42,0.58)",
  line: "rgba(148,163,184,0.22)",
};

export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 60,
  durationInFrames: 1200,
};
