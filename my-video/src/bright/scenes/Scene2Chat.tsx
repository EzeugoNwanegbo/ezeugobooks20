import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { PhoneCard } from "../PhoneCard";
import { Caption, Accent } from "../Caption";
import { SoftUnderline } from "../Highlights";
import { colors } from "../theme";

// Scene 2 — Pinpoint Chat · local frames 0–216 (5.5–12s + crossfade tail).
// chat.png, slow zoom toward the "FROM YOUR FILES" tag + Source line. A soft
// coral underline settles beneath the source citation.
export const Scene2Chat: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneCard
        src={staticFile("chat.png")}
        fallbackTitle="Pinpoint Chat — the exact passage, FROM YOUR FILES"
        fallbackTint={colors.coral}
        focusX={0.5}
        focusY={0.4}
        zoomFrom={1.0}
        zoomTo={1.12}
        zoomDuration={durationInFrames}
      >
        {/* Soft coral highlight under the "Source: ANATOMY OF THE PERINEUM.pptx"
            citation line on the cropped chat.png (498×885). */}
        <SoftUnderline left={0.18} top={0.555} width={0.66} delay={70} color={colors.coral} />
      </PhoneCard>

      <Caption
        delay={64}
        lines={[
          <>Ask anything.</>,
          <>
            Get the <Accent>exact answer</Accent> — and the source.
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
