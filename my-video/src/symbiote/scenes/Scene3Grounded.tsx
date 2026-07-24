import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, typed, calmSpring, slam, slide, OUT } from "../motion";
import { Caret } from "../components/Cursor";
import { GlassCard, SourceChip } from "../components/UI";

// A textbook page with body lines; two lines glow + get circled as "the answer".
const TextbookPage: React.FC<{ reveal: number; circle: number }> = ({ reveal, circle }) => {
  const lines = [
    { w: 0.9, hot: false },
    { w: 0.72, hot: false },
    { w: 0.85, hot: true },
    { w: 0.64, hot: true },
    { w: 0.8, hot: false },
    { w: 0.55, hot: false },
    { w: 0.88, hot: false },
  ];
  const circ = 2 * Math.PI * 300;
  return (
    <div
      style={{
        width: 560,
        height: 720,
        borderRadius: 26,
        background: "linear-gradient(160deg, #F6F2EA 0%, #E4DDCE 100%)",
        boxShadow: "0 40px 90px rgba(0,0,0,0.6)",
        padding: 56,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 40, color: colors.bg, marginBottom: 34 }}>
        The Krebs Cycle
      </div>
      {lines.map((l, i) => {
        const on = reveal > i / lines.length;
        const glow = l.hot && circle > 0.4;
        return (
          <div
            key={i}
            style={{
              height: 22,
              width: `${l.w * 100}%`,
              marginBottom: 26,
              borderRadius: 8,
              background: glow ? colors.electricDeep : l.hot ? "#B9B0A0" : "#C8C0B1",
              opacity: on ? (glow ? 1 : 0.9) : 0.15,
              boxShadow: glow ? `0 0 24px ${colors.glowElectric}` : undefined,
            }}
          />
        );
      })}
      {/* Hand-drawn circle around the hot lines. */}
      <svg style={{ position: "absolute", left: 20, top: 150, overflow: "visible" }} width={520} height={200}>
        <ellipse
          cx={260}
          cy={92}
          rx={252}
          ry={78}
          fill="none"
          stroke={colors.electric}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - circle)}
          transform="rotate(-3 260 92)"
          style={{ filter: `drop-shadow(0 0 10px ${colors.glowElectric})` }}
        />
      </svg>
    </div>
  );
};

// S3 — Grounded answer (10–18s). Ask → fast answer from the real page.
export const Scene3Grounded: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);

  const question = "What is the Krebs Cycle?";
  const q = typed(frame, 30, question, 22, 6);
  const asked = frame > 6 + (question.length / 22) * 30 + 4; // ~frame 45

  const answer =
    "It's the cell's central energy cycle — oxidising acetyl-CoA to release electrons for ATP.";
  const aReveal = interpolate(frame, [50, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const aChars = Math.floor(aReveal * answer.length);

  const pagePop = calmSpring(frame, 30, 60);
  const pageReveal = interpolate(frame, [66, 120], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const circle = interpolate(frame, [96, 140], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });

  // Headline lines.
  const h1 = slam(frame, 30, 150);
  const h2 = slide(frame, 30, 168, -1);
  const notRandom = interpolate(frame, [186, 200], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Chat column, top. */}
      <div style={{ position: "absolute", top: 150, left: 75, right: 75 }}>
        {/* Question bubble (right). */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div
            style={{
              maxWidth: 640,
              padding: "22px 30px",
              borderRadius: "26px 26px 6px 26px",
              background: colors.beige,
              color: colors.bg,
              fontFamily: fonts.sans,
              fontWeight: 600,
              fontSize: 40,
            }}
          >
            {q}
            {!asked && <Caret height={40} color={colors.bg} />}
          </div>
        </div>

        {/* Answer bubble (left). */}
        {frame > 48 && (
          <div style={{ display: "flex", marginTop: 26 }}>
            <GlassCard style={{ maxWidth: 720, padding: "26px 32px", borderRadius: "26px 26px 26px 6px" }}>
              <div style={{ fontFamily: fonts.sans, fontSize: 38, lineHeight: 1.3, color: colors.white }}>
                {answer.slice(0, aChars)}
                {aReveal < 1 && <Caret height={36} />}
              </div>
              {aReveal > 0.9 && (
                <div style={{ marginTop: 22 }}>
                  <SourceChip page="p. 214" file="Biochemistry.pdf" />
                </div>
              )}
            </GlassCard>
          </div>
        )}
      </div>

      {/* Textbook page card sliding up. */}
      {frame > 58 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: 780,
            transform: `translateX(-50%) translateY(${interpolate(pagePop, [0, 1], [420, 0])}px) scale(${interpolate(pagePop, [0, 1], [0.9, 1])})`,
          }}
        >
          <TextbookPage reveal={pageReveal} circle={circle} />
        </div>
      )}

      {/* Headlines, bottom. */}
      <div style={{ position: "absolute", bottom: 120, left: 0, right: 0, textAlign: "center" }}>
        {frame >= 148 && (
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 104, letterSpacing: -3, color: colors.white, opacity: h1.opacity, transform: h1.transform, filter: h1.filter }}>
            Answers.
          </div>
        )}
        {frame >= 166 && (
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 72, letterSpacing: -1, color: colors.beige, opacity: h2.opacity, transform: h2.transform, filter: h2.filter, textShadow: `0 0 40px ${colors.glow}` }}>
            From YOUR textbook.
          </div>
        )}
        {frame >= 186 && (
          <div style={{ marginTop: 10, fontFamily: fonts.sans, fontWeight: 600, fontSize: 44, color: colors.muted, opacity: notRandom }}>
            Not random AI.
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
