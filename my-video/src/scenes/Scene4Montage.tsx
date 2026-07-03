import React from "react";
import {
  AbsoluteFill,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { Background } from "../components/Background";
import { DeviceFrame } from "../components/DeviceFrame";
import { SmartShot } from "../components/SmartShot";
import { FlashcardMock } from "../components/mocks/FlashcardMock";
import { PracticeMock } from "../components/mocks/PracticeMock";
import { CoachMock } from "../components/mocks/CoachMock";
import { colors, fonts, SAFE } from "../theme";

const CARD = 40; // ~1.3s each · SFX cue: tick on each card.

const MontageCard: React.FC<{ src: string; fallback: React.ReactNode; label: string }> = ({
  src,
  fallback,
  label,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame, fps, config: { damping: 15, mass: 0.6, stiffness: 130 } });
  // Snappy entrance + slight outgoing drift.
  const inScale = interpolate(s, [0, 1], [0.86, 1]);
  const inOpacity = interpolate(frame, [0, 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const outOpacity = interpolate(frame, [CARD - 8, CARD], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const driftY = interpolate(frame, [0, CARD], [10, -24]);

  return (
    <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
      <div style={{ transform: `translateY(${driftY}px) scale(${inScale})`, opacity: inOpacity * outOpacity }}>
        <DeviceFrame width={920}>
          <SmartShot src={src} fallback={fallback} />
        </DeviceFrame>
        <div style={{ display: "flex", justifyContent: "center", marginTop: 34 }}>
          <div
            style={{
              padding: "14px 30px",
              borderRadius: 999,
              background: colors.champagne,
              color: colors.ink,
              fontFamily: fonts.sans,
              fontWeight: 700,
              fontSize: 34,
              boxShadow: "0 10px 40px rgba(201,188,163,0.25)",
            }}
          >
            {label}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

// Scene 4 — Study it your way. Rapid beat-synced montage.
export const Scene4Montage: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Background />

      {/* frames 0–40 */}
      <Sequence from={0} durationInFrames={CARD} layout="none">
        <MontageCard src={staticFile("flashcard.png")} fallback={<FlashcardMock />} label="Flash cards" />
      </Sequence>
      {/* frames 40–80 */}
      <Sequence from={CARD} durationInFrames={CARD} layout="none">
        <MontageCard
          src={staticFile("practice.png")}
          fallback={<PracticeMock />}
          label="Quiz yourself — MCQ, Essay, Exam"
        />
      </Sequence>
      {/* frames 80–120 */}
      <Sequence from={CARD * 2} durationInFrames={CARD} layout="none">
        <MontageCard
          src={staticFile("coach.png")}
          fallback={<CoachMock />}
          label="Build a roadmap, then practice it"
        />
      </Sequence>

      {/* Persistent kicker one-liner */}
      <div
        style={{
          position: "absolute",
          bottom: 90,
          left: SAFE.x,
          width: SAFE.width,
          textAlign: "center",
          opacity: interpolate(frame, [6, 18], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
        }}
      >
        <span style={{ fontFamily: fonts.serif, fontStyle: "italic", fontSize: 46, color: colors.white }}>
          Chat. Quiz. Master it.
        </span>
      </div>
    </AbsoluteFill>
  );
};
