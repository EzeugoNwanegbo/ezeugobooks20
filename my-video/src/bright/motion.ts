// Slow-motion helpers shared across the bright ad.
// Everything here favours long ranges + high-damping springs so motion stays
// calm and unhurried — never snappy.

import { Easing, interpolate, spring } from "remotion";

// Gentle ease used for almost every fade/zoom.
export const SOFT = Easing.bezier(0.16, 1, 0.3, 1);

// Opacity envelope for a scene's content: fades up over `inF` frames and fades
// out over the last `outF` frames of its local timeline. Used to crossfade
// between overlapping scene sequences.
export const sceneOpacity = (
  frame: number,
  durationInFrames: number,
  inF = 21,
  outF = 21,
) => {
  // No fade-out (final scene): just fade up and hold.
  if (outF <= 0) {
    return interpolate(frame, [0, inF], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: SOFT,
    });
  }
  return interpolate(
    frame,
    [0, inF, durationInFrames - outF, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: SOFT },
  );
};

// A very slow Ken Burns zoom from `from` → `to` across the whole scene.
export const slowZoom = (
  frame: number,
  durationInFrames: number,
  from = 1.0,
  to = 1.08,
) =>
  interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

// A soft, high-damping entrance spring (calm settle, no overshoot).
export const calmSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 1.1, stiffness: 90 },
    durationInFrames: Math.round(1.1 * fps),
  });

// A gentle, slow breathing pulse in [min,max] — for the CTA button.
export const breathe = (
  frame: number,
  fps: number,
  min = 1,
  max = 1.05,
  periodSec = 2.4,
) => {
  const t = (Math.sin((frame / (periodSec * fps)) * Math.PI * 2) + 1) / 2;
  return min + (max - min) * t;
};
