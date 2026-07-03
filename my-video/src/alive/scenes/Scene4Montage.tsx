import React from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity } from "../motion";
import { Frame, McqPanel, FlashcardPanel, RoadmapPanel } from "../components/Panels";
import { Kicker } from "../components/Caption";

// S4 — Feature montage (18–32s). Three fast beats, each a designed UI panel
// with a punch-in label. ~4.6s each over 14s. Nested Sequences reset the
// local frame so every panel animates from its own zero.
const BEAT = 138; // 4.6s @ 30fps

const Beat: React.FC<{ kicker: string; children: React.ReactNode }> = ({
  kicker,
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);
  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      <Kicker text={kicker} delay={4} top={270} />
      <div style={{ marginTop: 70 }}>{children}</div>
    </AbsoluteFill>
  );
};

export const Scene4Montage: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence durationInFrames={BEAT}>
        <Beat kicker="Practice smarter">
          <Frame title="GD1 · Practice" delay={6} width={800} height={1000}>
            <McqPanel
              delay={20}
              question="Which artery supplies the SA node in most hearts?"
              options={[
                "Left circumflex artery",
                "Right coronary artery",
                "Left anterior descending",
                "Posterior descending artery",
              ]}
              correct={1}
            />
          </Frame>
        </Beat>
      </Sequence>

      <Sequence from={BEAT} durationInFrames={BEAT}>
        <Beat kicker="Remember more">
          <Frame title="GD1 · Flashcards" delay={6} width={800} height={1000}>
            <FlashcardPanel
              delay={20}
              term="Accommodation"
              definition="The eye's adjustment of lens shape to focus on near objects."
            />
          </Frame>
        </Beat>
      </Sequence>

      <Sequence from={BEAT * 2} durationInFrames={BEAT}>
        <Beat kicker="A plan that adapts">
          <Frame title="GD1 · Roadmap" delay={6} width={800} height={1000}>
            <RoadmapPanel delay={18} />
          </Frame>
        </Beat>
      </Sequence>
    </AbsoluteFill>
  );
};
