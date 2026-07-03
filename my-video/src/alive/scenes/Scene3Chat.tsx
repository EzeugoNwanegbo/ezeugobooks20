import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { Frame, ChatPanel } from "../components/Panels";
import { Kicker, Caption, Accent } from "../components/Caption";

// S3 — Enter GD1 (8–18s). The hero beat: ask your material, get the exact
// answer + a source citation. The chat panel is fully designed in code.
export const Scene3Chat: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 12, 14);

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      <Kicker text="Ask anything" delay={6} top={260} />

      <div style={{ marginTop: 60 }}>
        <Frame title="GD1 · Chat" delay={8} width={800} height={1020}>
          <ChatPanel
            delay={26}
            prompt="Explain the Cushing reflex"
            answer={[
              "A response to raised intracranial pressure:",
              "hypertension, bradycardia, and irregular",
              "breathing — the body protecting brain perfusion.",
            ]}
            source="Guyton_Physiology.pdf · p.214"
          />
        </Frame>
      </div>

      <Caption
        delay={150}
        bottom={150}
        size={56}
        lines={[
          <>
            Straight from <Accent>your</Accent> material.
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
