import {loadFont as loadInter} from "@remotion/google-fonts/Inter";
import {loadFont as loadSora} from "@remotion/google-fonts/Sora";
import {loadFont as loadJetBrainsMono} from "@remotion/google-fonts/JetBrainsMono";

const inter = loadInter("normal", {weights: ["400", "500", "600", "700", "800"]});
const sora = loadSora("normal", {weights: ["500", "600", "700", "800"]});
const mono = loadJetBrainsMono("normal", {weights: ["400", "500", "600"]});

export const fonts = {display: sora.fontFamily, sans: inter.fontFamily, mono: mono.fontFamily};

export const colors = {
  black: "#030712",
  surface: "#0B1120",
  panel: "rgba(15, 23, 42, 0.76)",
  ink: "#F8FAFC",
  muted: "#94A3B8",
  blue: "#2563EB",
  blueBright: "#60A5FA",
  orange: "#F97316",
  orangeBright: "#FDBA74",
  gold: "#FACC15",
  line: "rgba(226, 232, 240, 0.16)",
};

// Native 4K vertical output; the scene design canvas is scaled cleanly from 1080×1920.
export const VIDEO = {width: 2160, height: 3840, fps: 60, durationInFrames: 2400};
