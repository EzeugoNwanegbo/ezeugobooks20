import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { popSpring, OUT } from "../motion";
import { colors, fonts, SAFE } from "../theme";

// Champagne accent span used inside caption lines.
export const Accent: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ color: colors.champagne, fontStyle: "italic", fontFamily: fonts.serif }}>
    {children}
  </span>
);

// Lower-third kinetic headline. Each line rises + fades in, staggered.
export const Caption: React.FC<{
  lines: React.ReactNode[];
  delay?: number;
  bottom?: number;
  size?: number;
  align?: "center" | "left";
}> = ({ lines, delay = 0, bottom = 300, size = 64, align = "center" }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.x,
        width: SAFE.width,
        bottom,
        textAlign: align,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "center" ? "center" : "flex-start",
        gap: 6,
      }}
    >
      {lines.map((line, i) => {
        const d = delay + i * 7;
        const s = popSpring(frame, fps, d);
        const y = interpolate(s, [0, 1], [40, 0]);
        const op = interpolate(frame, [d, d + 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: OUT,
        });
        return (
          <div
            key={i}
            style={{
              transform: `translateY(${y}px)`,
              opacity: op,
              color: colors.white,
              fontFamily: fonts.sans,
              fontWeight: 700,
              fontSize: size,
              lineHeight: 1.08,
              letterSpacing: -1,
              textShadow: "0 4px 30px rgba(0,0,0,0.6)",
            }}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
};

// Small uppercase label that punches in above feature panels.
export const Kicker: React.FC<{ text: string; delay?: number; top?: number }> = ({
  text,
  delay = 0,
  top = 250,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popSpring(frame, fps, delay);
  const op = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.x,
        width: SAFE.width,
        top,
        textAlign: "center",
        opacity: op,
        transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px)`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.mono,
          fontWeight: 600,
          fontSize: 30,
          letterSpacing: 8,
          textTransform: "uppercase",
          color: colors.champagne,
        }}
      >
        {text}
      </span>
    </div>
  );
};
