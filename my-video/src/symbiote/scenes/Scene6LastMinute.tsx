import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, popSpring, calmSpring, OUT } from "../motion";
import { Blob } from "../components/Blob";
import { GlassCard, Pill } from "../components/UI";

const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// A tiny PDF card.
const Pdf: React.FC<{ style?: React.CSSProperties }> = ({ style }) => (
  <div style={{ position: "absolute", width: 150, height: 196, borderRadius: 12, background: "linear-gradient(160deg,#F6F2EA,#DED6C6)", boxShadow: "0 18px 34px rgba(0,0,0,0.5)", padding: 16, ...style }}>
    <div style={{ width: 44, height: 18, borderRadius: 5, background: colors.red, marginBottom: 12, fontFamily: fonts.mono, fontSize: 12, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center" }}>PDF</div>
    {[0.9, 0.7, 0.8, 0.55].map((w, k) => (
      <div key={k} style={{ height: 8, width: `${w * 100}%`, background: "#BDB4A4", borderRadius: 4, marginBottom: 10 }} />
    ))}
  </div>
);

const OUTPUTS = ["Practice Questions", "Flashcards", "Revision tests", "Rapid review"];

// S6 — Last Minute (35–45s). Ten PDFs → Venom wrap → one smart revision guide.
export const Scene6LastMinute: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);
  const cx = width / 2;
  const cy = 720;

  const title = popSpring(frame, 30, 4);

  // PDFs converge to centre 22→80.
  const converge = interpolate(frame, [22, 80], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  // Blob wraps 78→124; then everything morphs into the summary card.
  const wrap = interpolate(frame, [78, 124], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  const morph = interpolate(frame, [120, 156], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: OUT });
  const pdfAlpha = interpolate(frame, [92, 120], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const cardPop = calmSpring(frame, 30, 128);
  const outStart = 178;

  return (
    <AbsoluteFill style={{ opacity }}>
      {/* Title. */}
      <div style={{ position: "absolute", top: 200, width: "100%", textAlign: "center", opacity: Math.min(1, title), transform: `scale(${interpolate(title, [0, 1], [0.9, 1])})` }}>
        <div style={{ fontFamily: fonts.sans, fontWeight: 600, fontSize: 34, color: colors.electric, letterSpacing: 8 }}>INTRODUCING</div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 140, letterSpacing: -4, color: colors.beige, textShadow: `0 0 50px ${colors.glow}` }}>LAST MINUTE</div>
      </div>

      {/* Ten PDFs flying in. */}
      {frame < 124 &&
        Array.from({ length: 10 }, (_, i) => {
          const ang = (i / 10) * Math.PI * 2 + 0.4;
          const startR = Math.max(width, height) * 0.62;
          const sx = cx + Math.cos(ang) * startR;
          const sy = cy + Math.sin(ang) * startR;
          const x = sx + (cx - sx) * converge;
          const y = sy + (cy - sy) * converge;
          const rot = (rnd(i, 3) - 0.5) * 120 * (1 - converge) + (rnd(i, 4) - 0.5) * 30;
          const jitter = converge >= 1 ? Math.sin(frame * 0.5 + i) * 4 : 0;
          return (
            <Pdf
              key={i}
              style={{
                left: x - 75 + jitter,
                top: y - 98 + jitter,
                transform: `rotate(${rot}deg) scale(${interpolate(converge, [0, 1], [0.7, 1]) * (1 - wrap * 0.3)})`,
                opacity: pdfAlpha,
              }}
            />
          );
        })}

      {/* Venom blob wraps the pile. */}
      {wrap > 0 && morph < 1 && (
        <Blob
          cx={cx}
          cy={cy}
          radius={interpolate(wrap, [0, 1], [120, 300]) * (1 - morph * 0.2)}
          color={colors.beige}
          wobble={0.28 * (1 - morph)}
          squareness={morph}
          rectW={620}
          rectH={760}
          opacity={interpolate(morph, [0, 0.8, 1], [1, 1, 0])}
          glow={50}
          seed={3}
        />
      )}

      {/* The one smart revision guide. */}
      {frame > 126 && (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: cy - 380,
            transform: `translateX(-50%) scale(${interpolate(cardPop, [0, 1], [0.82, 1])})`,
            opacity: Math.min(1, cardPop * 1.3),
          }}
        >
          <GlassCard glow style={{ width: 620, padding: 44 }}>
            <div style={{ fontFamily: fonts.display, fontWeight: 700, fontSize: 46, color: colors.white, marginBottom: 6 }}>Revision Guide</div>
            <div style={{ fontFamily: fonts.mono, fontSize: 26, color: colors.electric, marginBottom: 28 }}>10 sources · auto-organised</div>
            {["1 · Cell Respiration", "2 · The Krebs Cycle", "3 · Electron Transport", "4 · ATP Yield & Summary"].map((s, i) => {
              const app = interpolate(frame, [150 + i * 12, 164 + i * 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 18, padding: "18px 0", borderBottom: `1px solid ${colors.borderSoft}`, opacity: app, transform: `translateX(${interpolate(app, [0, 1], [-30, 0])}px)` }}>
                  <div style={{ width: 14, height: 14, borderRadius: 4, background: colors.beige }} />
                  <div style={{ fontFamily: fonts.sans, fontSize: 38, color: colors.white }}>{s}</div>
                </div>
              );
            })}
          </GlassCard>
        </div>
      )}

      {/* Coach outputs spawn. */}
      <div style={{ position: "absolute", top: 1140, width: "100%", display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", padding: "0 60px" }}>
        {OUTPUTS.map((o, i) => {
          const app = popSpring(frame, 30, outStart + i * 12);
          return (
            <div key={i} style={{ opacity: Math.min(1, app), transform: `scale(${interpolate(app, [0, 1], [0.6, 1])})` }}>
              <Pill color={colors.electric} bg="rgba(127,231,214,0.12)" style={{ fontSize: 34, borderColor: "rgba(127,231,214,0.4)" }}>
                {o}
              </Pill>
            </div>
          );
        })}
      </div>

      {/* Headline morph. */}
      <div style={{ position: "absolute", bottom: 120, width: "100%", textAlign: "center" }}>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: interpolate(morph, [0.4, 1], [70, 58], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), color: colors.muted, opacity: interpolate(frame, [230, 244, 268, 280], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          Ten documents.
        </div>
        <div style={{ fontFamily: fonts.display, fontWeight: 800, fontSize: 78, letterSpacing: -2, color: colors.beige, textShadow: `0 0 44px ${colors.glow}`, opacity: interpolate(frame, [274, 288], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }), transform: `scale(${interpolate(popSpring(frame, 30, 274), [0, 1], [0.85, 1])})` }}>
          One smart revision guide.
        </div>
      </div>
    </AbsoluteFill>
  );
};
