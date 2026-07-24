import React from "react";
import { AbsoluteFill, Sequence, interpolate, staticFile, useVideoConfig } from "remotion";
import { SmartAudio } from "../components/SmartAudio";
import { Backdrop } from "./components/Backdrop";
import { Scene1Hook } from "./scenes/Scene1Hook";
import { Scene2Upload } from "./scenes/Scene2Upload";
import { Scene3Grounded } from "./scenes/Scene3Grounded";
import { Scene4Highlight } from "./scenes/Scene4Highlight";
import { Scene5Coach } from "./scenes/Scene5Coach";
import { Scene6LastMinute } from "./scenes/Scene6LastMinute";
import { Scene7Montage } from "./scenes/Scene7Montage";
import { Scene8Final } from "./scenes/Scene8Final";
import { CROSSFADE } from "./theme";

// GD — "Symbiote" launch film · 9:16 · 1080×1920 · 30fps · 1800 frames (60s).
// 100% generated in code: no screenshots, no stock clips. Beat-synced to 128 BPM.
//
// Storyboard (start → end, seconds):
//   S1 Hook        0 –  5s   cursor → "…2,000 pages…" slams → pages explode → WHY?
//   S2 Upload      5 – 10s   drag book → instant upload → dissolve → UPLOAD·ASK·UNDERSTAND
//   S3 Grounded   10 – 18s   ask → answer from YOUR textbook, exact lines circled
//   S4 Highlight  18 – 25s   highlight one line → explainer grows out like liquid
//   S5 Coach      25 – 35s   MY COACH assembles; feature cards flip; mastery climbs
//   S6 LastMinute 35 – 45s   10 PDFs → Venom wrap → one smart revision guide
//   S7 Montage    45 – 55s   fast beat-cut: Upload·Ask·Highlight·Learn·Practice·Revise·Pass
//   Final         55 – 60s   Study Smarter. Not Longer. → GD · gd1.online
//
// Scenes own their own fade; sequences overlap by CROSSFADE for a seamless cut.
export const SymbioteAd: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();

  // Optional music: drop /public/music.mp3 (a ~128 BPM track) to add sound —
  // it auto fades in/out and lines up with the beat grid. Silent until then.
  const fadeOutStart = durationInFrames - Math.round(2 * fps);
  const volume = (f: number) =>
    interpolate(f, [0, Math.round(1 * fps), fadeOutStart, durationInFrames], [0, 0.85, 0.85, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });

  return (
    <AbsoluteFill>
      <Backdrop />
      <SmartAudio src={staticFile("music.mp3")} volume={volume} />

      <Sequence durationInFrames={150 + CROSSFADE}>
        <Scene1Hook />
      </Sequence>

      <Sequence from={150} durationInFrames={150 + CROSSFADE}>
        <Scene2Upload />
      </Sequence>

      <Sequence from={300} durationInFrames={240 + CROSSFADE}>
        <Scene3Grounded />
      </Sequence>

      <Sequence from={540} durationInFrames={210 + CROSSFADE}>
        <Scene4Highlight />
      </Sequence>

      <Sequence from={750} durationInFrames={300 + CROSSFADE}>
        <Scene5Coach />
      </Sequence>

      <Sequence from={1050} durationInFrames={300 + CROSSFADE}>
        <Scene6LastMinute />
      </Sequence>

      <Sequence from={1350} durationInFrames={300 + CROSSFADE}>
        <Scene7Montage />
      </Sequence>

      <Sequence from={1650} durationInFrames={150}>
        <Scene8Final />
      </Sequence>
    </AbsoluteFill>
  );
};
