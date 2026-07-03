import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { PhoneCard } from "../PhoneCard";
import { Caption, Accent } from "../Caption";
import { Spotlight } from "../Highlights";
import { colors } from "../theme";

// Scene 5 — Flash cards · local frames 0–186 (25.5–31s + crossfade tail).
// flashcard.png (Cubital Fossa, Card 2 of 10). Gentle zoom on the question.
export const Scene5Flashcards: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneCard
        src={staticFile("flashcard.png")}
        fallbackTitle="Flash card — “Cubital Fossa: Borders and Contents” · Card 2 of 10"
        fallbackTint={colors.teal}
        focusX={0.5}
        focusY={0.5}
        zoomFrom={1.0}
        zoomTo={1.1}
        zoomDuration={durationInFrames}
      >
        {/* Spotlight the question on the cropped flashcard.png (498×885). */}
        <Spotlight cx={0.5} cy={0.56} r={0.36} delay={26} color={colors.teal} />
      </PhoneCard>

      <Caption
        delay={40}
        lines={[
          <>Flip through flash cards</>,
          <>
            made from <Accent color={colors.teal}>your own files.</Accent>
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
