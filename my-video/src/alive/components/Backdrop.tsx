import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { colors } from "../theme";

// Persistent cinematic backdrop: deep near-black with two slowly drifting
// champagne glows and a vignette. Pure CSS/SVG — generated, no assets.
export const Backdrop: React.FC<{ intensity?: number }> = ({ intensity = 1 }) => {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();

  // Two radial glows drift on slow sine paths.
  const t = frame / durationInFrames;
  const g1x = width * (0.3 + 0.08 * Math.sin(frame / 120));
  const g1y = height * (0.28 + 0.05 * Math.cos(frame / 150));
  const g2x = width * (0.72 + 0.07 * Math.cos(frame / 110));
  const g2y = height * (0.78 + 0.05 * Math.sin(frame / 140 + 1));

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      {/* Base vertical gradient. */}
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, ${colors.bgSoft} 0%, ${colors.bg} 55%, #060607 100%)`,
        }}
      />
      {/* Drifting champagne glows. */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${g1x}px ${g1y}px, rgba(231,214,172,${0.16 * intensity}) 0%, rgba(231,214,172,0) 42%)`,
        }}
      />
      <AbsoluteFill
        style={{
          background: `radial-gradient(circle at ${g2x}px ${g2y}px, rgba(157,124,252,${0.1 * intensity}) 0%, rgba(157,124,252,0) 40%)`,
        }}
      />
      {/* Faint moving star/dust field for depth. */}
      <AbsoluteFill style={{ opacity: 0.5 * intensity }}>
        <svg width={width} height={height}>
          {DUST.map((d, i) => {
            const y = (d.y + t * d.s * 1.2) % 1;
            return (
              <circle
                key={i}
                cx={d.x * width}
                cy={y * height}
                r={d.r}
                fill={colors.champagne}
                opacity={d.o * (0.5 + 0.5 * Math.sin(frame / 30 + i))}
              />
            );
          })}
        </svg>
      </AbsoluteFill>
      {/* Vignette. */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 45%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

// Deterministic dust field (no Math.random at render time).
const DUST = Array.from({ length: 60 }, (_, i) => {
  const a = (i * 2654435761) % 1000;
  const b = (i * 40503) % 997;
  const c = (i * 92821) % 991;
  return {
    x: (a / 1000) % 1,
    y: (b / 997) % 1,
    r: 0.8 + ((c % 18) / 10),
    o: 0.15 + ((a % 30) / 100),
    s: 0.3 + ((b % 40) / 100),
  };
});
