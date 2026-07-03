import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { sceneOpacity, drift } from "../motion";
import { BookStack } from "../components/BookStack";
import { Caption } from "../components/Caption";
import { colors, fonts } from "../theme";

// S1 — The pain (0–4s). Buried in textbooks, a ticking clock, one cold question.
export const Scene1Pain: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 8, 14);
  const scale = drift(frame, durationInFrames, 1.08, 1.0); // slow pull-out

  // Ticking second hand.
  const tick = Math.floor(frame / 15);
  const angle = tick * 30;

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      {/* Clock, top */}
      <div style={{ position: "absolute", top: 230, opacity: 0.8 }}>
        <svg width={120} height={120}>
          <circle cx={60} cy={60} r={54} stroke={colors.champagneDim} strokeWidth={3} fill="none" />
          <line
            x1={60}
            y1={60}
            x2={60 + 40 * Math.sin((angle * Math.PI) / 180)}
            y2={60 - 40 * Math.cos((angle * Math.PI) / 180)}
            stroke={colors.champagne}
            strokeWidth={4}
            strokeLinecap="round"
          />
          <circle cx={60} cy={60} r={5} fill={colors.champagne} />
        </svg>
      </div>

      <div style={{ transform: `scale(${scale})`, marginTop: 80 }}>
        <BookStack delay={6} />
      </div>

      <Caption
        delay={40}
        bottom={420}
        size={70}
        lines={[<>Still studying</>, <span style={{ fontFamily: fonts.serif, fontStyle: "italic", color: colors.champagne }}>like this?</span>]}
      />
    </AbsoluteFill>
  );
};
