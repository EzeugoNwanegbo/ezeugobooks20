// GD — "Symbiote" launch film · brand tokens.
// Premium / futuristic: matte black + warm beige + electric glow.
// 100% generated in code — no screenshots, no stock. Fast, kinetic, beat-driven.

import { loadFont as loadSora } from "@remotion/google-fonts/Sora";
import { loadFont as loadHanken } from "@remotion/google-fonts/HankenGrotesk";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";

// Load fonts at module scope so they are ready before the first frame renders.
const sora = loadSora("normal", { weights: ["400", "600", "700", "800"] });
const hanken = loadHanken("normal", { weights: ["400", "500", "600", "700", "800"] });
const mono = loadMono("normal", { weights: ["400", "500", "600"] });

export const fonts = {
  // Bold geometric display for the kinetic headlines (Stitch "Symbiote" system).
  display: sora.fontFamily,
  // Clean grotesk for body / UI labels.
  sans: hanken.fontFamily,
  // Mono for typed prompts and source citations.
  mono: mono.fontFamily,
};

export const colors = {
  // Matte black base + one step lighter for panels.
  bg: "#0F0F0F",
  bgSoft: "#161615",
  panel: "#1A1A18",
  panelSoft: "#22221F",
  // Warm beige — the brand's signature.
  beige: "#E8DCC8",
  beigeDim: "#A79C88",
  beigeDeep: "#8A7F6C",
  // Soft white for high-contrast type.
  white: "#F6F2EA",
  muted: "#8B857A",
  mutedSoft: "#57534B",
  // Small electric accents (used sparingly for glow / highlights).
  electric: "#7FE7D6",
  electricDeep: "#2FA894",
  amber: "#F2C879",
  red: "#E8785C",
  // Borders + glows.
  border: "rgba(232, 220, 200, 0.22)",
  borderSoft: "rgba(232, 220, 200, 0.10)",
  glow: "rgba(232, 220, 200, 0.55)",
  glowElectric: "rgba(127, 231, 214, 0.6)",
};

// Composition constants — vertical 9:16, 60s cinematic cut.
export const VIDEO = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationInFrames: 1800, // 60s
};

// Center safe area — keep key text within ~86% width.
export const SAFE = { width: 930, x: 75 };

// Short, punchy crossfade between scenes (~0.4s at 30fps).
export const CROSSFADE = 12;

// ── Beat grid ───────────────────────────────────────────────────────────────
// Everything snaps to a 128 BPM grid so a music.mp3 dropped into /public later
// lines up with zero code changes. 128 BPM @ 30fps ≈ 14.06 frames per beat.
export const BPM = 128;
export const BEAT = (VIDEO.fps * 60) / BPM; // ≈ 14.06 frames

// Frame of the Nth beat (0-indexed), optionally offset from a scene start.
export const beat = (n: number, offset = 0) => offset + n * BEAT;

// How far past the most recent beat we are, in [0,1) — for beat-reactive pulses.
export const beatPhase = (frame: number, offset = 0) =>
  (((frame - offset) % BEAT) + BEAT) % BEAT / BEAT;

// A decaying "kick" envelope that spikes to 1 on each beat then falls off.
// Great for scaling / glow that punches on the beat.
export const kick = (frame: number, offset = 0, decay = 6) => {
  const since = (((frame - offset) % BEAT) + BEAT) % BEAT;
  return Math.exp(-since / decay);
};
