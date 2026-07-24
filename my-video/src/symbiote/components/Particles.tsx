import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

// Deterministic hash → [0,1).
const rnd = (i: number, salt = 1) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Knowledge-particle field.
//   burst    — explode outward from origin, fading as they fly (t 0→1).
//   assemble — start scattered across frame, converge into origin cluster (t 0→1).
//   drift    — gently float around origin forever.
export const Particles: React.FC<{
  count?: number;
  mode: "burst" | "assemble" | "drift";
  originX?: number; // fraction of width
  originY?: number; // fraction of height
  progress?: number; // 0→1 for burst / assemble
  spread?: number; // px
  color?: string;
  size?: [number, number];
  opacity?: number;
  glow?: boolean;
}> = ({
  count = 90,
  mode,
  originX = 0.5,
  originY = 0.5,
  progress = 0,
  spread = 700,
  color = colors.beige,
  size = [2, 7],
  opacity = 1,
  glow = true,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const ox = originX * width;
  const oy = originY * height;

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width="100%" height="100%" style={{ position: "absolute", overflow: "visible" }}>
        {Array.from({ length: count }, (_, i) => {
          const ang = rnd(i, 1) * Math.PI * 2;
          const dist = (0.3 + rnd(i, 2) * 0.7) * spread;
          const r = size[0] + rnd(i, 3) * (size[1] - size[0]);
          const wob = Math.sin(frame * (0.02 + rnd(i, 4) * 0.05) + i) * 14;

          let x: number;
          let y: number;
          let a: number;

          if (mode === "burst") {
            const e = interpolate(progress, [0, 1], [0, 1], { extrapolateRight: "clamp" });
            x = ox + Math.cos(ang) * dist * e + wob;
            y = oy + Math.sin(ang) * dist * e - progress * 40;
            a = interpolate(progress, [0, 0.7, 1], [0, 1, 0]);
          } else if (mode === "assemble") {
            const sx = rnd(i, 5) * width;
            const sy = rnd(i, 6) * height;
            const e = interpolate(progress, [0, 1], [0, 1], { extrapolateRight: "clamp" });
            const tx = ox + Math.cos(ang) * (rnd(i, 7) * 60);
            const ty = oy + Math.sin(ang) * (rnd(i, 7) * 60);
            x = sx + (tx - sx) * e + wob * (1 - e);
            y = sy + (ty - sy) * e;
            a = interpolate(progress, [0, 0.2, 0.9, 1], [0, 1, 1, 0]);
          } else {
            x = ox + Math.cos(ang) * dist * 0.5 + wob;
            y = oy + Math.sin(ang) * dist * 0.5 + Math.cos(frame * 0.03 + i) * 12;
            a = 0.4 + 0.5 * (0.5 + 0.5 * Math.sin(frame * 0.05 + i));
          }

          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={r}
              fill={color}
              opacity={Math.max(0, a)}
              style={glow ? { filter: "blur(0.4px)" } : undefined}
            />
          );
        })}
      </svg>
    </AbsoluteFill>
  );
};
