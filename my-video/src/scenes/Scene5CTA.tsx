import React from "react";
import {
  AbsoluteFill,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { SmartShot } from "../components/SmartShot";
import { colors, fonts, SAFE } from "../theme";

// Fallback wordmark when logo.png is absent.
const LogoMock: React.FC = () => (
  <div style={{ textAlign: "center" }}>
    <div
      style={{
        fontFamily: fonts.serif,
        fontWeight: 800,
        fontSize: 150,
        color: colors.champagne,
        letterSpacing: 2,
        textShadow: "0 0 60px rgba(201,188,163,0.3)",
      }}
    >
      G&amp;D
    </div>
    <div style={{ fontFamily: fonts.sans, fontSize: 38, letterSpacing: 16, color: colors.white, marginTop: 6 }}>
      STUDY&nbsp;AI
    </div>
  </div>
);

// Scene 5 — Logo + CTA. Glow, rule lines, button pulse, URL stamp.
export const Scene5CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoIn = spring({ frame, fps, config: { damping: 14, mass: 0.9 } });
  const logoScale = interpolate(logoIn, [0, 1], [0.7, 1]);
  const logoOpacity = interpolate(frame, [0, 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const glow = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  // Rule lines draw outward.
  const lineW = interpolate(frame, [14, 40], [0, SAFE.width], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: (t) => 1 - Math.pow(1 - t, 3) });

  const taglineO = interpolate(frame, [34, 48], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // SFX cue: soft pop at ~frame 50.
  const btnIn = spring({ frame: frame - 50, fps, config: { damping: 12, mass: 0.6 } });
  const btnScale = interpolate(btnIn, [0, 1], [0.8, 1]);
  // Gentle pulse after entrance.
  const pulse = 1 + 0.03 * Math.sin((frame - 50) / 6);
  const btnPulse = frame > 60 ? pulse : 1;

  const urlO = interpolate(frame, [62, 74], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Background glow={glow * 0.9} />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ width: SAFE.width, textAlign: "center" }}>
          {/* Logo */}
          <div style={{ transform: `scale(${logoScale})`, opacity: logoOpacity, display: "flex", justifyContent: "center" }}>
            <SmartShot
              src={staticFile("logo.png")}
              fallback={<LogoMock />}
              style={{ width: "auto", maxWidth: SAFE.width, maxHeight: 360, objectFit: "contain" }}
            />
          </div>

          {/* Rule line */}
          <div style={{ display: "flex", justifyContent: "center", margin: "44px 0 36px" }}>
            <div style={{ width: lineW, height: 2, background: `linear-gradient(90deg, transparent, ${colors.champagne}, transparent)` }} />
          </div>

          {/* Tagline */}
          <div
            style={{
              fontFamily: fonts.serif,
              fontStyle: "italic",
              fontSize: 52,
              color: colors.white,
              opacity: taglineO,
            }}
          >
            Pinpoint answers from your own material.
          </div>

          {/* CTA button */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 56 }}>
            <div
              style={{
                transform: `scale(${btnScale * btnPulse})`,
                padding: "26px 64px",
                borderRadius: 999,
                background: colors.cream,
                color: colors.ink,
                fontFamily: fonts.sans,
                fontWeight: 700,
                fontSize: 44,
                boxShadow: "0 16px 50px rgba(232,224,206,0.28)",
              }}
            >
              Get started free
            </div>
          </div>

          {/* URL stamp */}
          <div
            style={{
              marginTop: 40,
              fontFamily: fonts.mono,
              fontSize: 34,
              letterSpacing: 2,
              color: colors.champagne,
              opacity: urlO,
            }}
          >
            gd1.online
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
