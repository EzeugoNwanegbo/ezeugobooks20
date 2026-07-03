import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE } from "../theme";

// Bottom-anchored kinetic caption used across the product scenes.
export const Caption: React.FC<{ text: string; from?: number; accent?: boolean }> = ({
  text,
  from = 0,
  accent = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - from, fps, config: { damping: 16, mass: 0.6 } });
  const y = interpolate(s, [0, 1], [40, 0]);
  const o = interpolate(s, [0, 1], [0, 1]);
  return (
    <div
      style={{
        position: "absolute",
        bottom: 140,
        left: SAFE.x,
        width: SAFE.width,
        textAlign: "center",
        transform: `translateY(${y}px)`,
        opacity: o,
      }}
    >
      <span
        style={{
          fontFamily: fonts.serif,
          fontWeight: 700,
          fontSize: 60,
          lineHeight: 1.1,
          color: accent ? colors.champagne : colors.white,
          textShadow: "0 6px 30px rgba(0,0,0,0.6)",
        }}
      >
        {text}
      </span>
    </div>
  );
};
