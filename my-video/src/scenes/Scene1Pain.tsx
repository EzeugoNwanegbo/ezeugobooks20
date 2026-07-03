import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Background } from "../components/Background";
import { colors, fonts, SAFE } from "../theme";

// SFX cue: file rush (whoosh) at ~frame 0.
const FILES = [
  "Keith_Moore_Anatomy.pdf",
  "THE ARM, CUBITAL FOSSA.pdf",
  "Davidsons_Medicine.pdf",
  "lecture_notes.pdf",
  "Histology_slides.pptx",
  "Neuro_exam_scan.pdf",
];

export const Scene1Pain: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Headline punches in around 1.4s.
  const headIn = spring({ frame: frame - 42, fps, config: { damping: 14, mass: 0.7 } });
  const headScale = interpolate(headIn, [0, 1], [1.18, 1]);
  const headOpacity = interpolate(frame, [42, 52], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // Files dim once the headline lands.
  const filesDim = interpolate(frame, [44, 60], [1, 0.28], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <Background />
      {/* Files rush + stack */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: filesDim }}>
        <div style={{ width: SAFE.width, display: "flex", flexDirection: "column", gap: 16 }}>
          {FILES.map((f, i) => {
            const delay = i * 5;
            const s = spring({ frame: frame - delay, fps, config: { damping: 16, mass: 0.6 } });
            const x = interpolate(s, [0, 1], [i % 2 === 0 ? -700 : 700, 0]);
            const o = interpolate(s, [0, 1], [0, 1]);
            const rot = interpolate(s, [0, 1], [i % 2 === 0 ? -4 : 4, 0]);
            return (
              <div
                key={f}
                style={{
                  transform: `translateX(${x}px) rotate(${rot}deg)`,
                  opacity: o,
                  display: "flex",
                  alignItems: "center",
                  gap: 18,
                  padding: "20px 26px",
                  borderRadius: 14,
                  background: colors.bgSoft,
                  border: `1px solid ${colors.border}`,
                  fontFamily: fonts.mono,
                  fontSize: 30,
                  color: "#D8D2C6",
                }}
              >
                <span style={{ color: colors.champagne, fontSize: 26 }}>▤</span>
                {f}
              </div>
            );
          })}
        </div>
      </AbsoluteFill>

      {/* Kinetic serif headline */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
        <div
          style={{
            width: SAFE.width,
            transform: `scale(${headScale})`,
            opacity: headOpacity,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontFamily: fonts.serif,
              fontWeight: 800,
              fontSize: 110,
              lineHeight: 1.02,
              color: colors.champagne,
              textShadow: "0 0 60px rgba(201,188,163,0.25)",
            }}
          >
            1,400 pages.
          </div>
          <div
            style={{
              fontFamily: fonts.serif,
              fontWeight: 600,
              fontStyle: "italic",
              fontSize: 78,
              lineHeight: 1.1,
              color: colors.white,
              marginTop: 8,
            }}
          >
            One answer you need.
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
