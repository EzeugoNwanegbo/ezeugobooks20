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
import { ChatMock } from "../components/mocks/ChatMock";
import { Caption } from "../components/Caption";
import { colors, fonts } from "../theme";

// Scene 2 — Pinpoint Chat. Floating frame, typed question chip, citation lock-in.
export const Scene2Chat: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const enter = spring({ frame, fps, config: { damping: 18, mass: 0.9 } });
  // Ken-Burns: drift up + gentle zoom to reveal the citation.
  const scale = interpolate(frame, [0, 120], [1.02, 1.12], { extrapolateRight: "clamp" });
  const driftY = interpolate(frame, [0, 120], [20, -30], { extrapolateRight: "clamp" });
  const frameOpacity = interpolate(enter, [0, 1], [0, 1]);
  const frameY = interpolate(enter, [0, 1], [60, 0]);

  // Typed question chip.
  const q = "anatomy of the hand";
  const chipChars = Math.floor(interpolate(frame, [12, 40], [0, q.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));
  const chipS = spring({ frame: frame - 8, fps, config: { damping: 16 } });

  // SFX cue: citation lock-in (snap) at ~frame 64.
  const lock = spring({ frame: frame - 64, fps, config: { damping: 11, mass: 0.5 } });
  const lockScale = interpolate(lock, [0, 1], [0.7, 1]);
  const lockGlow = interpolate(frame, [64, 74, 110], [0, 1, 0.65], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            transform: `translateY(${frameY + driftY}px) scale(${scale})`,
            opacity: frameOpacity,
          }}
        >
          <DeviceFrame width={1000}>
            <SmartShot src={staticFile("chat.png")} fallback={<ChatMock />} />
          </DeviceFrame>
        </div>
      </AbsoluteFill>

      {/* Typed question chip (top) */}
      <div
        style={{
          position: "absolute",
          top: 170,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(chipS, [0, 1], [0, 1]),
          transform: `translateY(${interpolate(chipS, [0, 1], [-30, 0])}px)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "16px 28px",
            borderRadius: 999,
            background: "rgba(18,17,16,0.92)",
            border: `1px solid ${colors.border}`,
            backdropFilter: "blur(8px)",
            fontFamily: fonts.sans,
            fontSize: 34,
            color: colors.white,
            boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
          }}
        >
          <span style={{ color: colors.champagne, fontSize: 28 }}>⌕</span>
          {q.slice(0, chipChars)}
          <span style={{ opacity: frame % 20 < 10 ? 1 : 0, color: colors.champagne }}>|</span>
        </div>
      </div>

      {/* Citation lock-in chip */}
      <div
        style={{
          position: "absolute",
          bottom: 360,
          left: 0,
          width: "100%",
          display: "flex",
          justifyContent: "center",
          opacity: interpolate(lock, [0, 1], [0, 1]),
        }}
      >
        <div
          style={{
            transform: `scale(${lockScale})`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 26px",
            borderRadius: 12,
            background: colors.champagne,
            color: colors.ink,
            fontFamily: fonts.mono,
            fontSize: 28,
            fontWeight: 500,
            boxShadow: `0 0 ${30 * lockGlow}px rgba(201,188,163,${0.6 * lockGlow})`,
          }}
        >
          🔒 Keith Moore · pages 1286–1287
        </div>
      </div>

      <Caption text="Exact answer. With the source." from={48} accent />
    </AbsoluteFill>
  );
};
