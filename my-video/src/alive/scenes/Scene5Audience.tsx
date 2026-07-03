import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { sceneOpacity, popSpring } from "../motion";
import { Caption } from "../components/Caption";
import { colors, fonts } from "../theme";

// S5 — Who it's for (32–37s). No fabricated user counts — an outcome line,
// with the fields GD1 serves orbiting as chips.
const FIELDS = ["Medicine", "Nursing", "Engineering", "Law", "Pharmacy", "Biology"];

export const Scene5Audience: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 12, 14);

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          position: "absolute",
          top: 540,
          width: 900,
          display: "flex",
          flexWrap: "wrap",
          gap: 22,
          justifyContent: "center",
        }}
      >
        {FIELDS.map((f, i) => {
          const d = 6 + i * 6;
          const s = popSpring(frame, fps, d);
          const op = interpolate(frame, [d, d + 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={f}
              style={{
                opacity: op,
                transform: `scale(${interpolate(s, [0, 1], [0.7, 1])})`,
                padding: "20px 36px",
                borderRadius: 999,
                background: i % 2 ? "rgba(217,200,163,0.1)" : colors.panelSoft,
                border: `1.5px solid ${colors.border}`,
                fontFamily: fonts.sans,
                fontWeight: 600,
                fontSize: 38,
                color: colors.cream,
              }}
            >
              {f}
            </div>
          );
        })}
      </div>

      <Caption
        delay={48}
        bottom={520}
        size={64}
        lines={[
          <>One AI for</>,
          <span style={{ fontFamily: fonts.serif, fontStyle: "italic", color: colors.champagne }}>
            everything you study.
          </span>,
        ]}
      />
    </AbsoluteFill>
  );
};
