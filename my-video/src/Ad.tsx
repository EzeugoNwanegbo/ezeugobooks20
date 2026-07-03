import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { SmartAudio } from "./components/SmartAudio";
import { Scene1Pain } from "./scenes/Scene1Pain";
import { Scene2Chat } from "./scenes/Scene2Chat";
import { Scene3Proof } from "./scenes/Scene3Proof";
import { Scene4Montage } from "./scenes/Scene4Montage";
import { Scene5CTA } from "./scenes/Scene5CTA";
import { colors } from "./theme";

// G&D — Study AI · 9:16 vertical ad · 1080x1920 · 30fps · 540 frames (18s).
export const Ad: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  // Use the 25s → 50s slice of the track, with a fade-in and a ~1.5s fade-out.
  const fadeOutStart = durationInFrames - Math.round(1.5 * fps);
  const volume = (f: number) =>
    interpolate(
      f,
      [0, Math.round(0.6 * fps), fadeOutStart, durationInFrames],
      [0, 1, 1, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );

  return (
    <AbsoluteFill style={{ backgroundColor: colors.bg }}>
      <SmartAudio
        src={staticFile("music.mp3")}
        trimBefore={Math.round(25 * fps)}
        trimAfter={Math.round(50 * fps)}
        volume={volume}
      />

      {/* Scene 1 — The pain · frames 0–90 (0–3s) */}
      <Sequence from={0} durationInFrames={90}>
        <Scene1Pain />
      </Sequence>

      {/* Scene 2 — Pinpoint Chat · frames 90–210 (3–7s) */}
      <Sequence from={90} durationInFrames={120}>
        <Scene2Chat />
      </Sequence>

      {/* Scene 3 — Proof it's right · frames 210–330 (7–11s) */}
      <Sequence from={210} durationInFrames={120}>
        <Scene3Proof />
      </Sequence>

      {/* Scene 4 — Study it your way · frames 330–450 (11–15s) */}
      <Sequence from={330} durationInFrames={120}>
        <Scene4Montage />
      </Sequence>

      {/* Scene 5 — Logo + CTA · frames 450–540 (15–18s) */}
      <Sequence from={450} durationInFrames={90}>
        <Scene5CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
