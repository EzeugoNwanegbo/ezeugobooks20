import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, fold, popSpring, OUT } from "../motion";
import { Particles } from "../components/Particles";
import { GlassCard } from "../components/UI";

const FEATURES: { icon: string; label: string; sub: string }[] = [
  { icon: "✎", label: "Practice", sub: "Questions" },
  { icon: "⚡", label: "Flashcards", sub: "Active recall" },
  { icon: "≣", label: "Step-by-step", sub: "Explanations" },
  { icon: "◎", label: "Adaptive", sub: "Tutoring" },
  { icon: "↺", label: "Wrong-answer", sub: "Feedback" },
  { icon: "◈", label: "Weak-topic", sub: "Suggestions" },
];

const CoachCard: React.FC<{ f: (typeof FEATURES)[number]; delay: number }> = ({ f, delay }) => {
  const frame = useCurrentFrame();
  const s = fold(frame, 30, delay);
  return (
    <div style={{ opacity: s.opacity, transform: `${s.transform}`, transformOrigin: "center top" }}>
      <GlassCard style={{ width: 420, height: 210, padding: 30, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
        <div
          style={{
            width: 74,
            height: 74,
            borderRadius: 20,
            background: "rgba(232,220,200,0.12)",
            border: `1px solid ${colors.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 40,
            color: colors.beige,
          }}
        >
          {f.icon}
        </div>
        <div>
          <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 40, color: colors.white, letterSpacing: -1 }}>{f.label}</div>
          <div style={{ fontFamily: fonts.sans, fontSize: 28, color: colors.muted }}>{f.sub}</div>
        </div>
      </GlassCard>
    </div>
  );
};

// S5 — My Coach (25–35s). Title assembles from particles; feature cards flip in;
// mastery climbs; "Your Personal AI Coach."
export const Scene5Coach: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);

  // Particles assemble the title 0→48.
  const assemble = interpolate(frame, [0, 48], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const titlePop = popSpring(frame, 30, 30);

  // Mastery meter climbs as cards land.
  const mastery = interpolate(frame, [70, 210], [8, 96], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });

  const headline = popSpring(frame, 30, 232);

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center" }}>
      {/* Assembling particles behind the title. */}
      {frame < 60 && (
        <Particles mode="assemble" count={140} originY={0.16} progress={assemble} color={colors.beige} spread={500} />
      )}

      {/* MY COACH title. */}
      <div
        style={{
          position: "absolute",
          top: 210,
          textAlign: "center",
          opacity: Math.min(1, assemble * 1.6),
          transform: `scale(${interpolate(titlePop, [0, 1], [0.85, 1])})`,
        }}
      >
        <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 34, color: colors.electric, letterSpacing: 8, marginBottom: 8 }}>
          INTRODUCING
        </div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 150, letterSpacing: -4, color: colors.beige, textShadow: `0 0 50px ${colors.glow}` }}>
          MY COACH
        </div>
      </div>

      {/* Feature grid. */}
      <div
        style={{
          position: "absolute",
          top: 470,
          display: "grid",
          gridTemplateColumns: "420px 420px",
          gap: 30,
          justifyContent: "center",
        }}
      >
        {FEATURES.map((f, i) => (
          <CoachCard key={i} f={f} delay={56 + i * 16} />
        ))}
      </div>

      {/* Mastery meter. */}
      <div style={{ position: "absolute", top: 1290, width: 870 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontFamily: fonts.sans, fontSize: 30, color: colors.muted, marginBottom: 14 }}>
          <span>Mastery</span>
          <span style={{ color: colors.electric, fontFamily: fonts.mono }}>{Math.round(mastery)}%</span>
        </div>
        <div style={{ height: 18, borderRadius: 999, background: "rgba(232,220,200,0.12)", overflow: "hidden" }}>
          <div
            style={{
              width: `${mastery}%`,
              height: "100%",
              borderRadius: 999,
              background: `linear-gradient(90deg, ${colors.electricDeep}, ${colors.electric})`,
              boxShadow: `0 0 22px ${colors.glowElectric}`,
            }}
          />
        </div>
      </div>

      {/* Headline. */}
      {frame >= 230 && (
        <div
          style={{
            position: "absolute",
            bottom: 150,
            textAlign: "center",
            opacity: Math.min(1, headline),
            transform: `scale(${interpolate(headline, [0, 1], [0.9, 1])})`,
          }}
        >
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 90, letterSpacing: -2, color: colors.white }}>
            Your Personal
          </div>
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 90, letterSpacing: -2, color: colors.beige, textShadow: `0 0 40px ${colors.glow}` }}>
            AI Coach.
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
