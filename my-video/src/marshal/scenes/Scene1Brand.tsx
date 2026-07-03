import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { Logo } from "../components/Logo";
import { PaintWipe } from "../components/PaintWipe";
import { bounceIn, float, pulse } from "../motion";

// Scene 1 — Brand reveal · local frames 0–150 (0–5s).
// A red paint stroke whips across and pops the Marshal logo into place; a red
// line snaps under it; the tagline punches up. Energetic, confident.
export const Scene1Brand: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Fast reveal wipe.
  const wipe = interpolate(frame, [4, 26], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const reveal = interpolate(frame, [14, 22], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const logoPop = bounceIn(frame, fps, 16);
  const settle = Math.max(0, frame - 40);
  const logoScale = (0.7 + logoPop * 0.3) * pulse(settle, 0.012, 0.07);
  const logoFloat = float(settle, 9, 0.05);

  const lineW = interpolate(frame, [34, 50], [0, SAFE.width * 0.46], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tagOp = interpolate(frame, [48, 62], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const tagPop = bounceIn(frame, fps, 48);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.charcoal,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          opacity: reveal,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div style={{ transform: `translateY(${logoFloat}px) scale(${logoScale})` }}>
          <Logo width={620} />
        </div>

        <div
          style={{
            width: lineW,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.red,
            marginTop: 64,
          }}
        />

        <div
          style={{
            marginTop: 40,
            opacity: tagOp,
            transform: `translateY(${(1 - tagPop) * 36}px) scale(${0.92 + tagPop * 0.08})`,
            fontFamily: fonts.sans,
            fontWeight: 600,
            color: colors.offwhite,
            fontSize: 38,
            letterSpacing: 2,
            textAlign: "center",
          }}
        >
          Award-winning Nigerian paint brand · Since 1997.
        </div>
      </div>

      {/* Reveal stroke (whips off after passing). */}
      {frame < 32 && <PaintWipe progress={wipe} />}
    </AbsoluteFill>
  );
};
