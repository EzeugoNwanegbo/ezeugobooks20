import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { colors } from "./theme";
import { SOFT } from "./motion";

// Subtle highlight overlays drawn on top of a screenshot inside PhoneCard.
// All positions are fractions (0–1) of the card, so they're easy to nudge once
// the real screenshots are in /public. They're intentionally soft and tasteful.

// A coral underline that gently wipes in beneath a line of text (e.g. a source).
export const SoftUnderline: React.FC<{
  left: number;
  top: number;
  width: number;
  delay?: number;
  color?: string;
  thickness?: number;
}> = ({ left, top, width, delay = 30, color = colors.coral, thickness = 8 }) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [delay, delay + 28], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${width * 100 * grow}%`,
        height: thickness,
        borderRadius: thickness,
        background: color,
        opacity: 0.85 * grow,
        boxShadow: `0 0 18px ${color}66`,
      }}
    />
  );
};

// A soft radial spotlight that breathes in around a focal point.
export const Spotlight: React.FC<{
  cx: number;
  cy: number;
  r?: number;
  delay?: number;
  color?: string;
}> = ({ cx, cy, r = 0.26, delay = 10, color = colors.yellow }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [delay, delay + 26], [0, 0.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: o,
        background: `radial-gradient(${r * 100}% ${r * 60}% at ${cx * 100}% ${cy * 100}%, ${color} 0%, rgba(0,0,0,0) 70%)`,
        mixBlendMode: "multiply",
      }}
    />
  );
};

// A soft rounded highlight ring around a region (e.g. a correct answer row).
export const Ring: React.FC<{
  left: number;
  top: number;
  width: number;
  height: number;
  delay?: number;
  color?: string;
}> = ({ left, top, width, height, delay = 20, color = colors.green }) => {
  const frame = useCurrentFrame();
  const o = interpolate(frame, [delay, delay + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  const scale = interpolate(frame, [delay, delay + 30], [1.04, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  return (
    <div
      style={{
        position: "absolute",
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        width: `${width * 100}%`,
        height: `${height * 100}%`,
        border: `4px solid ${color}`,
        borderRadius: 22,
        opacity: o * 0.9,
        transform: `scale(${scale})`,
        boxShadow: `0 0 26px ${color}55, inset 0 0 26px ${color}22`,
      }}
    />
  );
};

// A glow that slides between several option positions (used in "study your way").
export const TravellingGlow: React.FC<{
  // stops as [x,y] fractions; glow eases from one to the next across the scene
  stops: [number, number][];
  durationInFrames: number;
  color?: string;
  size?: number;
}> = ({ stops, durationInFrames, color = colors.violet, size = 0.34 }) => {
  const frame = useCurrentFrame();
  const seg = durationInFrames / stops.length;
  const idx = Math.min(stops.length - 1, Math.floor(frame / seg));
  const next = Math.min(stops.length - 1, idx + 1);
  const local = interpolate(frame - idx * seg, [0, seg], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  const cx = stops[idx][0] + (stops[next][0] - stops[idx][0]) * local;
  const cy = stops[idx][1] + (stops[next][1] - stops[idx][1]) * local;
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(${size * 100}% ${size * 55}% at ${cx * 100}% ${cy * 100}%, ${color}3D 0%, rgba(0,0,0,0) 70%)`,
        mixBlendMode: "multiply",
      }}
    />
  );
};
