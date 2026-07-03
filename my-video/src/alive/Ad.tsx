import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { SmartAudio } from "../components/SmartAudio";
import { Backdrop } from "./components/Backdrop";
import { Scene1Pain } from "./scenes/Scene1Pain";
import { Scene2Magic } from "./scenes/Scene2Magic";
import { Scene3Chat } from "./scenes/Scene3Chat";
import { Scene4Montage } from "./scenes/Scene4Montage";
import { Scene5Audience } from "./scenes/Scene5Audience";
import { Scene6CTA } from "./scenes/Scene6CTA";
import { CROSSFADE } from "./theme";

// GD1 — "Your Textbook Came Alive" · 9:16 · 1080x1920 · 30fps · 1260 frames (42s).
// Everything is generated in code: no screenshots, no AI clips. Energetic cut.
//
// Storyboard (start → end, seconds):
//   S1 Pain      0.0 –  4.0s   buried in books, "Still studying like this?"
//   S2 Magic     4.0 –  8.0s   page wakes up, "could answer you?"
//   S3 Chat      8.0 – 18.0s   ask your material → exact answer + source
//   S4 Montage  18.0 – 32.0s   Practice / Flashcards / Roadmap
//   S5 Audience 32.0 – 37.0s   "One AI for everything you study."
//   S6 CTA      37.0 – 42.0s   logo, GD1.ONLINE, Try it free
//
// Scenes own their own fade (sceneOpacity), and sequences overlap by CROSSFADE.
export const TextbookAliveAd: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  // Optional music: drop /public/music.mp3 to add a track (auto fade in/out).
  const fadeOutStart = durationInFrames - Math.round(2 * fps);
  const volume = (f: number) =>
    interpolate(f, [0, Math.round(1 * fps), fadeOutStart, durationInFrames], [0, 0.8, 0.8, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill>
      <Backdrop />
      <SmartAudio src={staticFile("music.mp3")} volume={volume} />

      {/* S1 — Pain · 0–120 */}
      <Sequence durationInFrames={120 + CROSSFADE}>
        <Scene1Pain />
      </Sequence>

      {/* S2 — Magic · 120–240 */}
      <Sequence from={120} durationInFrames={120 + CROSSFADE}>
        <Scene2Magic />
      </Sequence>

      {/* S3 — Chat · 240–540 */}
      <Sequence from={240} durationInFrames={300 + CROSSFADE}>
        <Scene3Chat />
      </Sequence>

      {/* S4 — Montage · 540–954 (3 × 138) */}
      <Sequence from={540} durationInFrames={414 + CROSSFADE}>
        <Scene4Montage />
      </Sequence>

      {/* S5 — Audience · 954–1110 */}
      <Sequence from={954} durationInFrames={156 + CROSSFADE}>
        <Scene5Audience />
      </Sequence>

      {/* S6 — CTA · 1110–1260 */}
      <Sequence from={1110} durationInFrames={150}>
        <Scene6CTA />
      </Sequence>
    </AbsoluteFill>
  );
};
