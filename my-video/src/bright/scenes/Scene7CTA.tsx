import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { sceneOpacity, calmSpring, breathe, SOFT } from "../motion";
import { LogoPill } from "../LogoPill";

// Scene 7 — Calm close + CTA · local frames 0–120 (36–40s).
// Resolve to the bright background. Logo centred, tagline, a soft coral button
// gently pulses "Get started free", and the URL eases in. Hold.
export const Scene7CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  // No fade-out tail — this is the final hold.
  const opacity = sceneOpacity(frame, durationInFrames, 21, 0);

  const logoEnter = calmSpring(frame, fps, 4);
  const logoScale = 0.92 + 0.08 * logoEnter;

  const tagO = interpolate(frame, [22, 46], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });

  const btnEnter = calmSpring(frame, fps, 40);
  const btnPulse = breathe(frame, fps, 1, 1.045);

  const urlO = interpolate(frame, [62, 86], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });
  const urlY = interpolate(frame, [62, 90], [16, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 56,
        }}
      >
        <div style={{ transform: `scale(${logoScale})`, opacity: logoEnter }}>
          <LogoPill height={118} />
        </div>

        <div
          style={{
            width: SAFE.width,
            textAlign: "center",
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 60,
            lineHeight: 1.16,
            letterSpacing: -1,
            color: colors.ink,
            opacity: tagO,
          }}
        >
          Pinpoint answers from{" "}
          <span style={{ color: colors.coral }}>your own material.</span>
        </div>

        {/* Soft coral CTA button, gently breathing. */}
        <div
          style={{
            transform: `scale(${(0.94 + 0.06 * btnEnter) * btnPulse})`,
            opacity: btnEnter,
            background: colors.coral,
            color: "#FFF7F2",
            fontFamily: fonts.display,
            fontWeight: 700,
            fontSize: 50,
            padding: "34px 64px",
            borderRadius: 60,
            boxShadow: `0 26px 60px -22px ${colors.coral}AA`,
          }}
        >
          Get started free
        </div>

        <div
          style={{
            fontFamily: fonts.mono,
            fontWeight: 500,
            fontSize: 46,
            color: colors.inkSoft,
            opacity: urlO,
            transform: `translateY(${urlY}px)`,
            letterSpacing: 1,
          }}
        >
          gd1.online
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
