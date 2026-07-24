import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, punch, OUT } from "../motion";
import { GlassCard } from "../components/UI";

// Each montage beat: a big word + a UI motif flying through the camera.
const BEATS: { word: string; motif: React.ReactNode }[] = [
  { word: "UPLOAD", motif: <Motif label="PDF" tint={colors.beige} /> },
  { word: "ASK", motif: <Motif label="?" tint={colors.white} /> },
  { word: "HIGHLIGHT", motif: <Motif label="≡" tint={colors.electric} /> },
  { word: "LEARN", motif: <Motif label="✎" tint={colors.beige} /> },
  { word: "PRACTICE", motif: <Motif label="◎" tint={colors.white} /> },
  { word: "REVISE", motif: <Motif label="⚡" tint={colors.electric} /> },
  { word: "PASS", motif: <Motif label="✓" tint={colors.beige} /> },
];

function Motif({ label, tint }: { label: string; tint: string }) {
  return (
    <GlassCard glow tint="rgba(26,26,24,0.7)" style={{ width: 300, height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 150, color: tint }}>{label}</span>
    </GlassCard>
  );
}

const CUT = 40;

// S7 — Montage (45–55s). Fast beat-cut through the whole journey.
export const Scene7Montage: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 8, 14);

  const cut = Math.min(BEATS.length - 1, Math.floor(frame / CUT));
  const local = frame - cut * CUT;
  const b = BEATS[cut];

  // Motif flies from deep (huge) toward/past the camera.
  const fly = interpolate(local, [0, CUT], [0, 1], { extrapolateRight: "clamp", easing: OUT });
  const motifScale = interpolate(fly, [0, 1], [2.6, 0.45]);
  const motifBlur = interpolate(fly, [0, 0.3, 1], [18, 2, 12]);
  const motifOpacity = interpolate(fly, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);

  const w = punch(frame, 30, cut * CUT + 4);
  const last = cut === BEATS.length - 1;

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {/* Streaking speed lines. */}
      <AbsoluteFill style={{ opacity: 0.5 }}>
        <svg width="100%" height="100%">
          {Array.from({ length: 16 }, (_, i) => {
            const y = (i / 16) * 1920 + ((frame * 60) % 240) - 120;
            return <rect key={i} x={0} y={y} width={1080} height={2} fill={colors.beige} opacity={0.06 + (i % 3) * 0.03} />;
          })}
        </svg>
      </AbsoluteFill>

      {/* Flying motif behind the word. */}
      <div style={{ position: "absolute", transform: `scale(${motifScale}) rotate(${fly * 12 - 6}deg)`, filter: `blur(${motifBlur}px)`, opacity: motifOpacity }}>
        {b.motif}
      </div>

      {/* Big word punches on the beat. */}
      <div
        style={{
          position: "relative",
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: last ? 280 : 168,
          letterSpacing: -6,
          color: last ? colors.beige : colors.white,
          opacity: w.opacity,
          transform: w.transform,
          filter: w.filter,
          textShadow: last ? `0 0 70px ${colors.glow}` : `0 6px 30px rgba(0,0,0,0.5)`,
          WebkitTextStroke: last ? undefined : `1px rgba(232,220,200,0.2)`,
        }}
      >
        {b.word}
      </div>

      {/* Progress → confidence ticker at the bottom. */}
      <div style={{ position: "absolute", bottom: 150, fontFamily: fonts.mono, fontSize: 34, color: colors.muted, letterSpacing: 2 }}>
        {["pages", "answers", "flashcards", "quizzes", "progress", "momentum", "confidence"][cut]} →
      </div>
    </AbsoluteFill>
  );
};
