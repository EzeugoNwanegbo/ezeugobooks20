import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

// Persistent cinematic backdrop: matte black with two slowly drifting warm-beige
// glows, a fine grain field for depth, and a vignette. Pure CSS/SVG — no assets.
export const Backdrop: React.FC<{ intensity?: number; electric?: number }> = ({
  intensity = 1,
  electric = 0,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  const g1x = width * (0.28 + 0.08 * Math.sin(frame / 130));
  const g1y = height * (0.26 + 0.05 * Math.cos(frame / 160));
  const g2x = width * (0.74 + 0.07 * Math.cos(frame / 120));
  const g2y = height * (0.8 + 0.05 * Math.sin(frame / 150 + 1));

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${colors.bgSoft} 0%, ${colors.bg} 52%, #080807 100%)`,
        }}
      />
      {/* Drifting warm glows. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${g1x}px ${g1y}px, rgba(232,220,200,${0.14 * intensity}) 0%, rgba(232,220,200,0) 40%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${g2x}px ${g2y}px, rgba(232,220,200,${0.09 * intensity}) 0%, rgba(232,220,200,0) 38%)`,
        }}
      />
      {/* Optional electric accent glow (scenes pass electric > 0). */}
      {electric > 0 && (
        <AbsoluteFill
          style={{
            background: `radial-gradient(circle at ${width * 0.5}px ${height * 0.42}px, rgba(127,231,214,${0.14 * electric}) 0%, rgba(127,231,214,0) 45%)`,
          }}
        />
      )}
      {/* Grain / dust field. */}
      <AbsoluteFill style={{ opacity: 0.4 * intensity }}>
        <svg width={width} height={height}>
          {DUST.map((d, i) => (
            <circle
              key={i}
              cx={d.x * width}
              cy={((d.y + (frame / 1800) * d.s) % 1) * height}
              r={d.r}
              fill={colors.beige}
              opacity={d.o * (0.4 + 0.6 * Math.sin(frame / 28 + i))}
            />
          ))}
        </svg>
      </AbsoluteFill>
      {/* Vignette. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 44%, rgba(0,0,0,0) 42%, rgba(0,0,0,0.6) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// Deterministic dust field — no Math.random at render time.
const DUST = Array.from({ length: 70 }, (_, i) => {
  const a = (i * 2654435761) % 1000;
  const b = (i * 40503) % 997;
  const c = (i * 92821) % 991;
  return {
    x: (a / 1000) % 1,
    y: (b / 997) % 1,
    r: 0.7 + (c % 16) / 10,
    o: 0.12 + (a % 26) / 100,
    s: 0.2 + (b % 35) / 100,
  };
});
