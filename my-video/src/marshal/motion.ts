import { interpolate, spring } from "remotion";

// Energetic motion helpers — bouncy springs, punchy pops, and continuous
// micro-motion so nothing sits perfectly still.

// Snappy spring with overshoot. delay shifts the start (in frames).
export const pop = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 11, mass: 0.5, stiffness: 150 },
  });

// Even bouncier — for hero reveals.
export const bounceIn = (frame: number, fps: number, delay = 0) =>
  spring({
    frame: frame - delay,
    fps,
    config: { damping: 9, mass: 0.6, stiffness: 140 },
  });

// Continuous gentle bob (px). Keeps held elements alive.
export const float = (frame: number, amp = 8, speed = 0.06, phase = 0) =>
  Math.sin(frame * speed + phase) * amp;

// Continuous subtle pulse around 1.0 for scale.
export const pulse = (frame: number, amp = 0.015, speed = 0.08, phase = 0) =>
  1 + Math.sin(frame * speed + phase) * amp;

// Quick punch: a short scale spike that settles to 1 (for count ticks etc).
export const punch = (frame: number, at: number, size = 0.18, len = 8) =>
  interpolate(frame, [at, at + len * 0.4, at + len], [1, 1 + size, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
