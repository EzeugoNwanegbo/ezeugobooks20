import {loadFont as loadInter} from "@remotion/google-fonts/Inter";
import {loadFont as loadSora} from "@remotion/google-fonts/Sora";
import {loadFont as loadJetBrainsMono} from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", {weights: ["400", "500", "600", "700", "800"]});
const sora = loadSora("normal", {weights: ["500", "600", "700", "800"]});
const mono = loadJetBrainsMono("normal", {weights: ["400", "500", "600"]});

export const fonts = {
  display: sora.fontFamily,
  sans: inter.fontFamily,
  mono: mono.fontFamily,
};

export const colors = {
  bg: "#0B0C0B",
  panel: "#171915",
  panelSoft: "#21241E",
  cream: "#F4F0E7",
  muted: "#A9AAA0",
  line: "rgba(244, 240, 231, 0.15)",
  lime: "#C8FA65",
  mint: "#78E8C5",
  coral: "#FF8F70",
  lavender: "#B7A8FF",
};

export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1200,
};

export const SAFE = {left: 76, right: 76};
