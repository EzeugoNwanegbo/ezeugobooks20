import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { colors, fonts, SAFE } from "./theme";
import { SOFT } from "./motion";

// A calm caption that lives in the bottom safe area, on a soft frosted plate so
// it stays legible over the screenshot or the bright background. Fades in late
// and holds. Supports an emphasised colour word fragment.
export const Caption: React.FC<{
  // Use \n in `text` to force line breaks. Wrap an emphasis span via `accent`.
  lines: React.ReactNode[];
  delay?: number; // frames before it begins to appear
  bottom?: number;
}> = ({ lines, delay = 24, bottom = 96 }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [delay, delay + 24], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  const rise = interpolate(frame, [delay, delay + 30], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });

  return (
    <div
      style={{
        position: "absolute",
        left: SAFE.x,
        width: SAFE.width,
        bottom,
        opacity,
        transform: `translateY(${rise}px)`,
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: "rgba(255, 252, 245, 0.82)",
          border: `1px solid ${colors.cardBorder}`,
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
          borderRadius: 34,
          padding: "30px 42px",
          boxShadow: "0 18px 50px -24px rgba(120, 70, 20, 0.35)",
          textAlign: "center",
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: 50,
              lineHeight: 1.18,
              color: colors.ink,
              letterSpacing: -0.5,
            }}
          >
            {line}
          </div>
        ))}
      </div>
    </div>
  );
};

// Emphasis word helper for captions.
export const Accent: React.FC<{ children: React.ReactNode; color?: string }> = ({
  children,
  color = colors.coral,
}) => <span style={{ color }}>{children}</span>;
