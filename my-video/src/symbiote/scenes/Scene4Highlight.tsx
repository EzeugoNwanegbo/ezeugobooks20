import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, popSpring, slam, OUT } from "../motion";
import { GlassCard } from "../components/UI";
import { Pointer } from "../components/Cursor";

// S4 — Highlight (18–25s). Highlight one sentence → explanation grows beside it.
export const Scene4Highlight: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);

  // Explanation paragraph — the highlighted sentence is line index 2.
  const paragraph = [
    "The mitochondrion powers the cell.",
    "It turns nutrients into ATP.",
    "Acetyl-CoA enters the Krebs cycle,", // ← highlighted
    "releasing carriers for the chain.",
    "That's where energy is made.",
  ];
  const hotIndex = 2;

  // Highlight sweeps across the hot line 34→64.
  const sweep = interpolate(frame, [34, 62], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  // Floating card grows out of the highlight 66→...
  const grow = popSpring(frame, 30, 66);

  const h1 = slam(frame, 30, 120);
  const h2 = interpolate(frame, [144, 158], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const cardTop = 470;
  const lineH = 92;
  const hotLineY = cardTop + 60 + hotIndex * lineH;

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Explanation card. */}
      <GlassCard
        style={{
          position: "absolute",
          left: 75,
          top: cardTop,
          width: 930,
          padding: "60px 56px",
        }}
      >
        <div style={{ fontFamily: fonts.sans, fontWeight: 700, fontSize: 34, color: colors.beige, marginBottom: 28, letterSpacing: 1 }}>
          AI EXPLANATION
        </div>
        {paragraph.map((line, i) => {
          const isHot = i === hotIndex;
          const fade = interpolate(frame, [i * 4, i * 4 + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ position: "relative", height: lineH - 20, marginBottom: 20 }}>
              {/* highlight background */}
              {isHot && (
                <div
                  style={{
                    position: "absolute",
                    left: -10,
                    top: -6,
                    height: "100%",
                    width: `calc(${sweep * 100}% + 20px)`,
                    maxWidth: "102%",
                    borderRadius: 10,
                    background: "rgba(127,231,214,0.28)",
                    boxShadow: sweep > 0.9 ? `0 0 24px ${colors.glowElectric}` : undefined,
                  }}
                />
              )}
              <div
                style={{
                  position: "relative",
                  fontFamily: fonts.sans,
                  fontSize: 44,
                  lineHeight: 1.6,
                  whiteSpace: "nowrap",
                  color: isHot ? colors.white : colors.muted,
                  opacity: fade,
                  fontWeight: isHot ? 600 : 400,
                }}
              >
                {line}
              </div>
            </div>
          );
        })}
      </GlassCard>

      {/* Pointer selecting the sentence. */}
      {frame > 30 && frame < 70 && (
        <Pointer x={110 + sweep * 760} y={hotLineY + 30} clicking={sweep > 0.05 && sweep < 0.98} />
      )}

      {/* Floating explanation growing out of the highlight, like liquid. */}
      {frame > 64 && (
        <div
          style={{
            position: "absolute",
            left: 150,
            top: hotLineY + 90,
            transformOrigin: "top left",
            transform: `scale(${interpolate(grow, [0, 1], [0.2, 1])})`,
            opacity: Math.min(1, grow * 1.4),
          }}
        >
          {/* connector nub */}
          <div style={{ position: "absolute", left: 60, top: -14, width: 28, height: 28, borderRadius: 8, background: colors.electric, transform: "rotate(45deg)", boxShadow: `0 0 20px ${colors.glowElectric}` }} />
          <GlassCard
            glow
            tint="rgba(20,32,30,0.7)"
            style={{ width: 720, padding: "34px 40px", border: `1px solid rgba(127,231,214,0.4)` }}
          >
            <div style={{ fontFamily: fonts.mono, fontSize: 26, color: colors.electric, marginBottom: 14 }}>
              ↳ instant explainer
            </div>
            <div style={{ fontFamily: fonts.sans, fontSize: 40, lineHeight: 1.4, color: colors.white }}>
              Acetyl-CoA is the 2-carbon fuel that <b style={{ color: colors.beige }}>kicks off</b> the
              cycle — no scrolling, no new tab.
            </div>
          </GlassCard>
        </div>
      )}

      {/* Headlines. */}
      <div style={{ position: "absolute", bottom: 110, left: 0, right: 0, textAlign: "center" }}>
        {frame >= 118 && (
          <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 118, letterSpacing: -3, color: colors.white, opacity: h1.opacity, transform: h1.transform, filter: h1.filter }}>
            Highlight.
          </div>
        )}
        {frame >= 144 && (
          <div style={{ marginTop: 6, fontFamily: fonts.display, fontWeight: 800, fontSize: 74, letterSpacing: -1, color: colors.beige, opacity: h2, textShadow: `0 0 40px ${colors.glow}` }}>
            Understand instantly.
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
