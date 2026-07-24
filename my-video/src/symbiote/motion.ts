// Motion helpers for the "Symbiote" launch film.
// Includes the kinetic-typography verbs the brief demands: slam, punch, slide,
// explode, stretch, fold, morph, ripple — each returns a CSS style object you can
// spread onto a word. Timing is energetic: short springs, hard overshoot.

import { Easing, interpolate, spring } from "remotion";

// ── Easings ──────────────────────────────────────────────────────────────────
export const OUT = Easing.bezier(0.16, 1, 0.3, 1); // punchy ease-out
export const INOUT = Easing.inOut(Easing.cubic);
export const SNAP = Easing.bezier(0.85, 0, 0.15, 1); // magnetic snap
export const ELASTIC = Easing.elastic(1.1);

// ── Scene opacity envelope ─────────────────────────────────────────────────────
// Fade up over `inF`, fade out over the last `outF`. outF = 0 → fade up + hold.
export const sceneOpacity = (
  frame: number,
  durationInFrames: number,
  inF = 10,
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

// ── Springs ────────────────────────────────────────────────────────────────────
// Hard overshoot (a word that slaps and bounces).
export const slamSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 11, mass: 0.8, stiffness: 180 },
    durationInFrames: Math.round(0.8 * fps),
  });

// Elastic pop (overshoot + settle).
export const popSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 13, mass: 0.7, stiffness: 150 },
    durationInFrames: Math.round(0.9 * fps),
  });

// Smooth settle, no overshoot — panels / cards.
export const calmSpring = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 200, mass: 1, stiffness: 120 },
    durationInFrames: Math.round(0.75 * fps),
  });

// ── Ambient motion ─────────────────────────────────────────────────────────────
export const drift = (frame: number, durationInFrames: number, from = 1.0, to = 1.06) =>
  interpolate(frame, [0, durationInFrames], [from, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.ease),
  });

export const breathe = (frame: number, fps: number, min = 1, max = 1.05, periodSec = 2) => {
  const t = (Math.sin((frame / (periodSec * fps)) * Math.PI * 2) + 1) / 2;
  return min + (max - min) * t;
};

// Motion-blur helper: blur proportional to per-frame movement (px/frame).
export const motionBlur = (speedPxPerFrame: number, max = 14) =>
  `blur(${Math.min(max, Math.abs(speedPxPerFrame) * 0.12)}px)`;

// Typewriter: characters of `text` revealed by `frame`, at `cps` chars/sec.
export const typed = (frame: number, fps: number, text: string, cps = 30, delay = 0) => {
  const chars = Math.max(0, Math.floor(((frame - delay) / fps) * cps));
  return text.slice(0, Math.min(text.length, chars));
};

// ── Kinetic typography verbs ────────────────────────────────────────────────────
// Each takes (frame, fps, delay) and returns a style object { opacity, transform,
// filter? }. Designed for a per-word wrapper. `p` is the eased 0→1 progress.
export type KineticStyle = {
  opacity: number;
  transform: string;
  filter?: string;
};

const prog = (frame: number, fps: number, delay: number, dur: number, easing = OUT) =>
  interpolate(frame - delay, [0, dur * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

// SLAM — drops from above, overshoots down, snaps back. Heavy.
export const slam = (frame: number, fps: number, delay = 0): KineticStyle => {
  const s = slamSpring(frame, fps, delay);
  const y = interpolate(s, [0, 1], [-260, 0]);
  const scale = interpolate(s, [0, 0.7, 1], [1.5, 1.05, 1]);
  const opacity = interpolate(frame - delay, [0, 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity, transform: `translateY(${y}px) scale(${scale})`, filter: motionBlur((1 - s) * -260) };
};

// PUNCH — bursts out toward the camera, tiny recoil.
export const punch = (frame: number, fps: number, delay = 0): KineticStyle => {
  const s = popSpring(frame, fps, delay);
  const scale = interpolate(s, [0, 0.6, 1], [2.6, 0.94, 1]);
  const opacity = interpolate(frame - delay, [0, 2], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity, transform: `scale(${scale})`, filter: `blur(${(1 - Math.min(1, s * 1.4)) * 10}px)` };
};

// SLIDE — rushes in from the left with a motion-blur streak.
export const slide = (frame: number, fps: number, delay = 0, dir = -1): KineticStyle => {
  const s = popSpring(frame, fps, delay);
  const x = interpolate(s, [0, 1], [dir * 520, 0]);
  const opacity = interpolate(frame - delay, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity, transform: `translateX(${x}px)`, filter: motionBlur((1 - s) * dir * 520) };
};

// EXPLODE — from nothing, scales up fast with a soft glow blur out.
export const explode = (frame: number, fps: number, delay = 0): KineticStyle => {
  const p = prog(frame, fps, delay, 0.5);
  const scale = interpolate(p, [0, 1], [0.2, 1]);
  const blur = interpolate(p, [0, 0.6, 1], [24, 6, 0]);
  return { opacity: p, transform: `scale(${scale})`, filter: `blur(${blur}px)` };
};

// STRETCH — squashes wide then snaps to shape.
export const stretch = (frame: number, fps: number, delay = 0): KineticStyle => {
  const s = popSpring(frame, fps, delay);
  const sx = interpolate(s, [0, 0.55, 1], [1.9, 0.92, 1]);
  const sy = interpolate(s, [0, 0.55, 1], [0.5, 1.06, 1]);
  const opacity = interpolate(frame - delay, [0, 3], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return { opacity, transform: `scale(${sx}, ${sy})` };
};

// FOLD — rotates down from a flat 3D edge like a card flip.
export const fold = (frame: number, fps: number, delay = 0): KineticStyle => {
  const s = calmSpring(frame, fps, delay);
  const rot = interpolate(s, [0, 1], [-92, 0]);
  const opacity = interpolate(frame - delay, [0, 5], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return {
    opacity,
    transform: `perspective(900px) rotateX(${rot}deg)`,
  };
};

// MORPH — blurs and un-skews into place, like it congealed from liquid.
export const morph = (frame: number, fps: number, delay = 0): KineticStyle => {
  const p = prog(frame, fps, delay, 0.6);
  const skew = interpolate(p, [0, 1], [16, 0]);
  const blur = interpolate(p, [0, 0.7, 1], [18, 4, 0]);
  const scale = interpolate(p, [0, 1], [0.86, 1]);
  return { opacity: p, transform: `skewX(${skew}deg) scale(${scale})`, filter: `blur(${blur}px)` };
};

// RIPPLE — per-letter is handled by the component; this is the base rise.
export const ripple = (frame: number, fps: number, delay = 0): KineticStyle => {
  const s = popSpring(frame, fps, delay);
  const y = interpolate(s, [0, 1], [40, 0]);
  return { opacity: Math.min(1, s * 1.4), transform: `translateY(${y}px)` };
};

export type Verb =
  | "slam"
  | "punch"
  | "slide"
  | "explode"
  | "stretch"
  | "fold"
  | "morph"
  | "ripple";

export const VERBS: Record<Verb, (f: number, fps: number, delay?: number) => KineticStyle> = {
  slam,
  punch,
  slide: (f, fps, d) => slide(f, fps, d),
  explode,
  stretch,
  fold,
  morph,
  ripple,
};
