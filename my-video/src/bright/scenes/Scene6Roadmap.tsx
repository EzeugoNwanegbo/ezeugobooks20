import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { PhoneCard } from "../PhoneCard";
import { Caption, Accent } from "../Caption";
import { colors } from "../theme";

// Scene 6 — Your roadmap · local frames 0–171 (31–36s + crossfade tail).
// roadmap.png (My Coach roadmap, 9 topics). Slow pan down the topic list.
export const Scene6Roadmap: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames);

  return (
    <AbsoluteFill style={{ opacity }}>
      <PhoneCard
        src={staticFile("roadmap.png")}
        fallbackTitle="My Coach roadmap — 9 topics · “Overview of the Arm” · “Muscles of the Anterior Compartment”"
        fallbackTint={colors.yellow}
        focusX={0.5}
        focusY={0.5}
        // Hold a constant slight zoom-in so the image overflows the card enough
        // that the vertical pan never exposes the card background.
        zoomFrom={1.14}
        zoomTo={1.18}
        zoomDuration={durationInFrames}
        // Gentle pan: start high on the list, drift down through the topics.
        panFrom={5}
        panTo={-5}
      />

      <Caption
        delay={36}
        lines={[
          <>Turn your files into a roadmap —</>,
          <>
            and <Accent color={colors.coral}>master every topic.</Accent>
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
