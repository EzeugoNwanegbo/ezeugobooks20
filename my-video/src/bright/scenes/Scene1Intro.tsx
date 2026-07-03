import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { sceneOpacity, calmSpring, SOFT } from "../motion";
import { LogoPill } from "../LogoPill";

// Scene 1 — Warm intro · local frames 0–186 (0–5.5s + crossfade tail).
// Logo eases in inside its dark pill; a friendly headline fades up phrase by
// phrase, slowly. Calm hold.
export const Scene1Intro: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  // Logo settle.
  const logoEnter = calmSpring(frame, fps, 6);
  const logoScale = 0.9 + 0.1 * logoEnter;
  const logoRise = (1 - logoEnter) * 30;

  // Headline phrases fade up one at a time, unhurried.
  const phrases: { text: string; accent?: boolean }[] = [
    { text: "Big files." },
    { text: "One question." },
    { text: "The exact answer.", accent: true },
  ];

  return (
    <AbsoluteFill style={{ opacity }}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 70,
        }}
      >
        <div
          style={{
            transform: `translateY(${logoRise}px) scale(${logoScale})`,
            opacity: logoEnter,
          }}
        >
          <LogoPill height={120} />
        </div>

        <div
          style={{
            width: SAFE.width,
            textAlign: "center",
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {phrases.map((p, i) => {
            const delay = 40 + i * 34;
            const o = interpolate(frame, [delay, delay + 26], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: SOFT,
            });
            const y = interpolate(frame, [delay, delay + 30], [26, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: SOFT,
            });
            return (
              <div
                key={i}
                style={{
                  fontFamily: fonts.display,
                  fontWeight: 800,
                  fontSize: 84,
                  lineHeight: 1.08,
                  letterSpacing: -1.5,
                  color: p.accent ? colors.coral : colors.ink,
                  opacity: o,
                  transform: `translateY(${y}px)`,
                }}
              >
                {p.text}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
