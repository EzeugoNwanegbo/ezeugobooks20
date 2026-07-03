import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { PhoneCard } from "../PhoneCard";
import { Caption, Accent } from "../Caption";
import { Ring, SoftUnderline } from "../Highlights";
import { colors } from "../theme";

// Scene 4 — Instant, cited feedback · local frames 0–231 (18.5–25.5s + tail).
// mcq.png. Slowly bring attention to the correct answer (C. Tibial nerve) glowing
// green, the wrong answer (A. Deep fibular nerve) in red, then the cited source.
export const Scene4Feedback: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneCard
        src={staticFile("mcq.png")}
        fallbackTitle="MCQ — C. Tibial nerve ✓ (green), A. Deep fibular nerve ✗ (red), with explanation + Page 1680"
        fallbackTint={colors.green}
        focusX={0.5}
        focusY={0.5}
        zoomFrom={1.0}
        zoomTo={1.08}
        zoomDuration={durationInFrames}
      >
        {/* On the cropped mcq.png (591×1032): green ring on the correct row
            (C. Tibial nerve), red ring on the wrong row (A. Deep fibular nerve),
            then a coral underline under "Correct answer: C. Tibial nerve". */}
        <Ring left={0.081} top={0.475} width={0.838} height={0.052} delay={36} color={colors.green} />
        <Ring left={0.081} top={0.339} width={0.838} height={0.055} delay={64} color={colors.red} />
        <SoftUnderline left={0.186} top={0.668} width={0.5} delay={104} color={colors.coral} />
      </PhoneCard>

      <Caption
        delay={48}
        lines={[
          <>
            Instant <Accent color={colors.green}>feedback.</Accent>
          </>,
          <>Every answer backed by your notes.</>,
        ]}
      />
    </AbsoluteFill>
  );
};
