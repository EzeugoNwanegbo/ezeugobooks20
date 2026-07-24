import React from "react";
import { useCurrentFrame } from "remotion";
import { colors } from "../theme";

// Blinking text caret. Blinks every ~half second unless `steady`.
export const Caret: React.FC<{
  height?: number;
  color?: string;
  steady?: boolean;
  style?: React.CSSProperties;
}> = ({ height = 90, color = colors.beige, steady = false, style }) => {
  const frame = useCurrentFrame();
  const on = steady ? 1 : Math.floor(frame / 15) % 2 === 0 ? 1 : 0.15;
  return (
    <span
      style={{
        display: "inline-block",
        width: Math.max(4, height * 0.06),
        height,
        background: color,
        opacity: on,
        borderRadius: 2,
        boxShadow: `0 0 16px ${colors.glow}`,
        verticalAlign: "middle",
        ...style,
      }}
    />
  );
};

// Mouse pointer that can be positioned and clicked.
export const Pointer: React.FC<{
  x: number;
  y: number;
  clicking?: boolean;
  scale?: number;
}> = ({ x, y, clicking = false, scale = 1 }) => (
  <div
    style={{
      position: "absolute",
      left: x,
      top: y,
      transform: `scale(${clicking ? scale * 0.86 : scale})`,
      filter: "drop-shadow(0 6px 10px rgba(0,0,0,0.5))",
    }}
  >
    <svg width={44} height={48} viewBox="0 0 44 48">
      <path
        d="M4 2 L4 40 L14 30 L20 44 L28 40 L22 26 L36 26 Z"
        fill={colors.white}
        stroke={colors.bg}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </svg>
    {clicking && (
      <div
        style={{
          position: "absolute",
          left: -18,
          top: -18,
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: `2px solid ${colors.electric}`,
          opacity: 0.7,
        }}
      />
    )}
  </div>
);
