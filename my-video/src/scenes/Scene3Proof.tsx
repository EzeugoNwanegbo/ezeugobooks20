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
import { DeviceFrame } from "../components/DeviceFrame";
import { SmartShot } from "../components/SmartShot";
import { McqMock } from "../components/mocks/McqMock";
import { Caption } from "../components/Caption";
import { colors, fonts } from "../theme";

// Scene 3 — Proof it's right. MCQ with green ✓ pop + Page 32 citation.
export const Scene3Proof: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.9 } });
  const frameOpacity = interpolate(enter, [0, 1], [0, 1]);
  const frameY = interpolate(enter, [0, 1], [50, 0]);
  const scale = interpolate(frame, [0, 120], [1.0, 1.08], { extrapolateRight: "clamp" });

  // SFX cue: green ✓ pop at ~frame 40.
  const pop = spring({ frame: frame - 40, fps, config: { damping: 9, mass: 0.5, stiffness: 140 } });
  const popScale = interpolate(pop, [0, 1], [0, 1]);
  const ringScale = interpolate(frame, [40, 70], [0.6, 1.8], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const ringOpacity = interpolate(frame, [40, 70], [0.7, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div style={{ transform: `translateY(${frameY}px) scale(${scale})`, opacity: frameOpacity }}>
          <DeviceFrame width={1000}>
            <SmartShot src={staticFile("mcq.png")} fallback={<McqMock />} />
          </DeviceFrame>
        </div>
      </AbsoluteFill>

      {/* Green ✓ pop with expanding ring */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", pointerEvents: "none" }}>
        <div style={{ position: "relative", transform: "translateY(-120px)" }}>
          <div
            style={{
              position: "absolute",
              inset: -10,
              borderRadius: 999,
              border: `4px solid ${colors.green}`,
              transform: `scale(${ringScale})`,
              opacity: ringOpacity,
              width: 150,
              height: 150,
              left: -65,
              top: -65,
            }}
          />
          <div
            style={{
              width: 150,
              height: 150,
              borderRadius: 999,
              background: colors.green,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              transform: `scale(${popScale})`,
              boxShadow: `0 0 60px rgba(34,197,94,0.6)`,
              color: "#06250F",
              fontSize: 90,
              fontWeight: 800,
              fontFamily: fonts.sans,
            }}
          >
            ✓
          </div>
        </div>
      </AbsoluteFill>

      {/* Page citation chip slides up */}
      <div
        style={{
          position: "absolute",
          bottom: 360,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(frame, [70, 86], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [70, 86], [40, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}px)`,
        }}
      >
        <div
          style={{
            padding: "13px 24px",
            borderRadius: 12,
            background: "rgba(18,17,16,0.92)",
            border: `1px solid ${colors.border}`,
            fontFamily: fonts.mono,
            fontSize: 26,
            color: colors.champagne,
          }}
        >
          p. 32 · Keith_Moore.pdf
        </div>
      </div>

      <Caption text="Evidence first. Then it explains." from={52} accent />
    </AbsoluteFill>
  );
};
