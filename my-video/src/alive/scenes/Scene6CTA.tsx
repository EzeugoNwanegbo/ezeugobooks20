import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { sceneOpacity, popSpring, breathe, OUT } from "../motion";
import { Logo } from "../components/Logo";
import { colors, fonts } from "../theme";

// S6 — Hero / CTA (37–42s). Logo glows in, feature chips orbit, then the
// wordmark, tagline and a breathing "Try it free" button.
const ORBIT = ["Chat with PDFs", "Practice", "Flashcards", "Roadmap"];

export const Scene6CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 12, 0);

  const logoS = popSpring(frame, fps, 6);
  const glow = interpolate(frame, [6, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Chips settle from an orbit into a row.
  const settle = interpolate(frame, [30, 70], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });

  const tagOp = interpolate(frame, [62, 78], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ctaScale = breathe(frame, fps, 1, 1.05);
  const ctaOp = interpolate(frame, [80, 95], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      {/* Logo */}
      <div
        style={{
          transform: `scale(${interpolate(logoS, [0, 1], [0.6, 1])})`,
          marginTop: -260,
        }}
      >
        <Logo size={150} glow={glow} />
      </div>

      {/* Orbiting feature chips */}
      <div style={{ position: "absolute", top: "50%", left: "50%", width: 0, height: 0 }}>
        {ORBIT.map((label, i) => {
          const a = (i / ORBIT.length) * Math.PI * 2 - Math.PI / 2;
          const R = interpolate(settle, [0, 1], [300, 0]);
          const orbitX = Math.cos(a + frame / 60) * R;
          const orbitY = Math.sin(a + frame / 60) * R;
          // Final row position.
          const rowX = (i - (ORBIT.length - 1) / 2) * 250;
          const rowY = 40;
          const x = interpolate(settle, [0, 1], [orbitX, rowX]);
          const y = interpolate(settle, [0, 1], [orbitY, rowY]);
          return (
            <div
              key={label}
              style={{
                position: "absolute",
                transform: `translate(${x}px, ${y}px) translate(-50%, -50%)`,
                padding: "16px 26px",
                borderRadius: 999,
                background: colors.panelSoft,
                border: `1.5px solid ${colors.border}`,
                whiteSpace: "nowrap",
                display: "flex",
                alignItems: "center",
                gap: 12,
              }}
            >
              <span style={{ color: colors.green, fontSize: 26 }}>✓</span>
              <span style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 30, color: colors.cream }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Tagline + URL */}
      <div style={{ position: "absolute", top: 1180, textAlign: "center", opacity: tagOp }}>
        <div
          style={{
            fontFamily: fonts.serif,
            fontWeight: 800,
            fontSize: 92,
            color: colors.cream,
            letterSpacing: 1,
          }}
        >
          GD1.ONLINE
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            fontSize: 40,
            color: colors.champagne,
            marginTop: 8,
          }}
        >
          Stop reading harder. Start studying smarter.
        </div>
      </div>

      {/* CTA button */}
      <div
        style={{
          position: "absolute",
          top: 1420,
          opacity: ctaOp,
          transform: `scale(${ctaScale})`,
        }}
      >
        <div
          style={{
            padding: "30px 80px",
            borderRadius: 999,
            background: `linear-gradient(135deg, ${colors.gold}, ${colors.champagne})`,
            color: colors.bg,
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 46,
            boxShadow: `0 0 70px rgba(231,214,172,0.5)`,
          }}
        >
          Try it free
        </div>
      </div>
    </AbsoluteFill>
  );
};
