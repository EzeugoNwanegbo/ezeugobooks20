import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { PhoneCard } from "../PhoneCard";
import { Caption, Accent } from "../Caption";
import { TravellingGlow } from "../Highlights";
import { colors } from "../theme";

// Scene 3 — Study your way · local frames 0–216 (12–18.5s + crossfade tail).
// practice_setup.png. A soft glow drifts gently between the option groups
// (MCQ · Essay · Flash cards · Learning/Exam · Easy/Medium/Hard).
export const Scene3StudyWays: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneCard
        src={staticFile("practice_setup.png")}
        fallbackTitle="Set up practice — MCQ · Essay · Flash cards · Learning / Exam · Easy → Hard"
        fallbackTint={colors.violet}
        focusX={0.5}
        focusY={0.5}
        zoomFrom={1.0}
        zoomTo={1.07}
        zoomDuration={durationInFrames}
      >
        {/* Glow eases through the option rows of the cropped practice_setup.png
            (498×885): MCQ → Essay → Flash cards → Learning → Difficulty → Start. */}
        <TravellingGlow
          stops={[
            [0.28, 0.427], // MCQ
            [0.71, 0.427], // Essay
            [0.71, 0.49], // Flash cards
            [0.28, 0.608], // Learning
            [0.5, 0.752], // Easy/Medium/Hard
            [0.5, 0.929], // Start practice
          ]}
          durationInFrames={durationInFrames}
          color={colors.violet}
        />
      </PhoneCard>

      <Caption
        delay={40}
        lines={[
          <>Study your way —</>,
          <>
            <Accent color={colors.violet}>quizzes, essays, flash cards.</Accent>
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
