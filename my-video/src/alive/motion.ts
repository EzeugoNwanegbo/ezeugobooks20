// Motion helpers shared across the "Textbook Came Alive" ad.
// Pacing here is energetic: snappier springs + shorter ranges than the bright ad.

import { Easing, interpolate, spring } from "remotion";

// Punchy ease-out used for most entrances.
export const OUT = Easing.bezier(0.16, 1, 0.3, 1);
// Quick in-out for crossfades.
export const INOUT = Easing.inOut(Easing.cubic);

// Scene opacity envelope: fade up over `inF`, fade out over the last `outF`.
// Pass outF = 0 for the final scene (fade up + hold).
export const sceneOpacity = (
  frame: number,
  durationInFrames: number,
  inF = 12,
  outF = 12,
) => {
  if (outF <= 0) {
    return interpolate(frame, [0, inF], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: OUT,
    });
  }
  return interpolate(
    frame,
    [0, inF, durationInFrames - outF, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: INOUT },
  );
};

// Energetic entrance spring (a little overshoot, then settle).
export const popSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, mass: 0.7, stiffness: 140 },
    durationInFrames: Math.round(0.9 * fps),
  });

// Smooth settle spring (no overshoot) — for panels / cards.
export const calmSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 1, stiffness: 110 },
    durationInFrames: Math.round(0.8 * fps),
  });

// Ken Burns-ish drift across a scene.
export const drift = (
  frame: number,
  durationInFrames: number,
  from = 1.0,
  to = 1.06,
) =>
  interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

// Gentle breathing pulse in [min,max] — for the CTA button glow.
export const breathe = (
  frame: number,
  fps: number,
  min = 1,
  max = 1.05,
  periodSec = 2,
) => {
  const t = (Math.sin((frame / (periodSec * fps)) * Math.PI * 2) + 1) / 2;
  return min + (max - min) * t;
};

// Number of characters of `text` to reveal at `frame`, typing at `cps` chars/sec.
export const typed = (
  frame: number,
  fps: number,
  text: string,
  cps = 28,
  delay = 0,
) => {
  const chars = Math.max(0, Math.floor(((frame - delay) / fps) * cps));
  return text.slice(0, Math.min(text.length, chars));
};
