import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, popSpring, punch, breathe } from "../motion";
import { RippleText } from "../components/KineticText";
import { Logo } from "../components/Logo";
import { Particles } from "../components/Particles";

// Final — brand close (55–60s). "Study Smarter." / "Not Longer." → logo → CTA.
export const Scene8Final: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = sceneOpacity(frame, 150, 10, 0); // fade in, hold to the end

  // Phase 1 (taglines) fades out as Phase 2 (brand) fades in ~frame 74.
  const taglineOut = interpolate(frame, [70, 82], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const brandIn = interpolate(frame, [80, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const notLonger = punch(frame, 30, 46);
  const logoPop = popSpring(frame, 30, 84);
  const glow = breathe(frame, 30, 0.8, 1.25, 2.4);

  const siteIn = interpolate(frame, [104, 118], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const taglineIn = interpolate(frame, [122, 138], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity, background: colors.bg, alignItems: "center", justifyContent: "center" }}>
      {/* Soft drifting particles in the background. */}
      <Particles mode="drift" count={60} originY={0.5} spread={1200} color={colors.beige} opacity={0.5 * (0.6 + 0.4 * brandIn)} />

      {/* Phase 1 — taglines. */}
      {frame < 84 && (
        <div style={{ opacity: taglineOut, textAlign: "center" }}>
          <RippleText text="Study Smarter." delay={10} stagger={2} size={130} weight={800} color={colors.beige} />
          {frame >= 44 && (
            <div
              style={{
                marginTop: 24,
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: 130,
                letterSpacing: -3,
                color: colors.white,
                opacity: notLonger.opacity,
                transform: notLonger.transform,
                filter: notLonger.filter,
              }}
            >
              Not Longer.
            </div>
          )}
        </div>
      )}

      {/* Phase 2 — brand. */}
      {frame >= 78 && (
        <div style={{ opacity: brandIn, display: "flex", flexDirection: "column", alignItems: "center", gap: 50 }}>
          <div style={{ transform: `scale(${interpolate(logoPop, [0, 1], [0.7, 1])})` }}>
            <Logo size={240} glow={glow} />
          </div>

          <div
            style={{
              fontFamily: fonts.mono,
              fontWeight: 600,
              fontSize: 64,
              letterSpacing: 2,
              color: colors.beige,
              opacity: siteIn,
              transform: `translateY(${interpolate(siteIn, [0, 1], [20, 0])}px)`,
              textShadow: `0 0 30px ${colors.glow}`,
            }}
          >
            gd1.online
          </div>

          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 500,
              fontSize: 42,
              color: colors.muted,
              opacity: taglineIn,
              transform: `translateY(${interpolate(taglineIn, [0, 1], [16, 0])}px)`,
            }}
          >
            Your textbooks. Powered by AI.
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
