import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { SmartAudio } from "../components/SmartAudio";
import { Background } from "./Background";
import { Scene1Intro } from "./scenes/Scene1Intro";
import { Scene2Chat } from "./scenes/Scene2Chat";
import { Scene3StudyWays } from "./scenes/Scene3StudyWays";
import { Scene4Feedback } from "./scenes/Scene4Feedback";
import { Scene5Flashcards } from "./scenes/Scene5Flashcards";
import { Scene6Roadmap } from "./scenes/Scene6Roadmap";
import { Scene7CTA } from "./scenes/Scene7CTA";
import { CROSSFADE } from "./theme";

// G&D — Study AI · BRIGHT ad · 9:16 vertical · 1080x1920 · 30fps · 1200 frames (40s).
// Slow & unhurried: a persistent sunny background, with scene sequences that
// overlap by CROSSFADE (~0.7s) so each one soft-crossfades into the next.
//
// Storyboard (start → end, seconds):
//   S1 Intro        0.0 –  5.5s
//   S2 Chat         5.5 – 12.0s
//   S3 Study ways  12.0 – 18.5s
//   S4 Feedback    18.5 – 25.5s
//   S5 Flash cards 25.5 – 31.0s
//   S6 Roadmap     31.0 – 36.0s
//   S7 CTA         36.0 – 40.0s
//
// Each Sequence is padded by +CROSSFADE frames so its content lingers and fades
// out while the next scene fades in (scenes own their fade via sceneOpacity).
export const BrightAd: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  // Optional music: gentle fade-in / fade-out. Renders only if music.mp3 exists.
  const fadeOutStart = durationInFrames - Math.round(2 * fps);
  const volume = (f: number) =>
    interpolate(
      f,
      [0, Math.round(1.2 * fps), fadeOutStart, durationInFrames],
      [0, 0.85, 0.85, 0],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
    );

  return (
    <AbsoluteFill>
      {/* Persistent sunny background beneath every scene. */}
      <Background />

      {/* Optional, easily removable calm soundtrack. */}
      <SmartAudio src={staticFile("music.mp3")} volume={volume} />

      {/* S1 — Warm intro · frames 0–186 */}
      <Sequence from={0} durationInFrames={165 + CROSSFADE}>
        <Scene1Intro />
      </Sequence>

      {/* S2 — Pinpoint Chat · frames 165–381 */}
      <Sequence from={165} durationInFrames={195 + CROSSFADE}>
        <Scene2Chat />
      </Sequence>

      {/* S3 — Study your way · frames 360–576 */}
      <Sequence from={360} durationInFrames={195 + CROSSFADE}>
        <Scene3StudyWays />
      </Sequence>

      {/* S4 — Instant, cited feedback · frames 555–786 */}
      <Sequence from={555} durationInFrames={210 + CROSSFADE}>
        <Scene4Feedback />
      </Sequence>

      {/* S5 — Flash cards · frames 765–951 */}
      <Sequence from={765} durationInFrames={165 + CROSSFADE}>
        <Scene5Flashcards />
      </Sequence>

      {/* S6 — Your roadmap · frames 930–1101 */}
      <Sequence from={930} durationInFrames={150 + CROSSFADE}>
        <Scene6Roadmap />
      </Sequence>

      {/* S7 — Calm close + CTA · frames 1080–1200 */}
      <Sequence from={1080} durationInFrames={120}>
        <Scene7CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
