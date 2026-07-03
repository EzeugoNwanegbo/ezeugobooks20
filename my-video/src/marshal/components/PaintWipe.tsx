import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors } from "../theme";

// Signature motif: one confident red paint-stroke / roller wipe per cut.
// `progress` 0 → 1 sweeps a red band from off-screen left, fully covering the
// frame around the midpoint (hiding the scene swap), then off to the right.
// Both edges are brushy (wavy) for a roller-stroke feel.

const W = 1080;
const H = 1920;
const STEPS = 10;

// Wavy vertical edge sampled top→bottom at x = base + wobble.
const edgePoints = (base: number, amp: number, phase: number): [number, number][] => {
  const pts: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) {
    const y = (H / STEPS) * i;
    const wobble = Math.sin(i * 1.6 + phase) * amp + Math.cos(i * 0.8 + phase) * amp * 0.5;
    pts.push([base + wobble, y]);
  }
  return pts;
};

const bandPath = (trail: number, lead: number): string => {
  const leadPts = edgePoints(lead, 44, 0);
  const trailPts = edgePoints(trail, 38, 1.1).reverse();
  const all = [...leadPts, ...trailPts];
  return (
    all.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") +
    " Z"
  );
};

export const PaintWipe: React.FC<{ progress: number }> = ({ progress }) => {
  // Leading edge travels from off-left to off-right; trailing edge follows.
  const lead = interpolate(progress, [0, 1], [-240, W + 300]);
  const trail = interpolate(progress, [0, 1], [-(W + 300), W - 240]);

  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }}>
        <path d={bandPath(trail, lead)} fill={colors.red} />
        {/* Subtle roller highlight near the leading edge. */}
        <path d={bandPath(lead - 90, lead)} fill={colors.redDeep} opacity={0.22} />
      </svg>
    </AbsoluteFill>
  );
};

// Self-timed wipe over `frames`, driven by the local Sequence frame.
export const PaintWipeTimed: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const progress = interpolate(frame, [0, frames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <PaintWipe progress={progress} />;
};
