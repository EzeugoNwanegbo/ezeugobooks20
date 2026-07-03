import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "./theme";
import { SOFT } from "./motion";

// Warm, sunny gradient that gently shifts over the full 40s so the frame feels
// alive but calm. Two soft radial "sun" glows drift slowly across it.
export const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Slowly rotate the base linear gradient angle over the whole ad.
  const angle = interpolate(frame, [0, durationInFrames], [115, 145], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });

  // Drift the warm glow centres a little.
  const gx = interpolate(frame, [0, durationInFrames], [25, 75]);
  const gy = interpolate(frame, [0, durationInFrames], [20, 38]);
  const gx2 = interpolate(frame, [0, durationInFrames], [80, 40]);

  return (
    <AbsoluteFill
      style={{
        background: `linear-gradient(${angle}deg, ${colors.bg1} 0%, ${colors.bg2} 55%, ${colors.bg3} 100%)`,
      }}
    >
      {/* Soft sunny highlight glow, top. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(60% 42% at ${gx}% ${gy}%, rgba(255, 233, 199, 0.85) 0%, rgba(255, 233, 199, 0) 70%)`,
        }}
      />
      {/* Faint coral warmth, lower. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(55% 40% at ${gx2}% 88%, rgba(255, 162, 122, 0.30) 0%, rgba(255, 162, 122, 0) 72%)`,
        }}
      />
    </AbsoluteFill>
  );
};
