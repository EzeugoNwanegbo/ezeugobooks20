import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, punch, OUT, calmSpring } from "../motion";
import { Particles } from "../components/Particles";
import { Pointer } from "../components/Cursor";
import { GlassCard } from "../components/UI";

// A tilted textbook rendered in code (spine + cover + pages edge).
const Book: React.FC<{ scale?: number }> = ({ scale = 1 }) => (
  <div style={{ transform: `scale(${scale})`, transformOrigin: "center" }}>
    <div
      style={{
        position: "relative",
        width: 300,
        height: 400,
        transform: "rotate(-8deg)",
        filter: "drop-shadow(0 30px 50px rgba(0,0,0,0.55))",
      }}
    >
      {/* pages edge */}
      <div style={{ position: "absolute", right: -12, top: 8, width: 300, height: 384, background: "#EDE7DA", borderRadius: 8 }} />
      {/* cover */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 10,
          background: `linear-gradient(150deg, ${colors.panelSoft} 0%, ${colors.bg} 100%)`,
          border: `1px solid ${colors.border}`,
          padding: 34,
        }}
      >
        <div style={{ width: 70, height: 70, borderRadius: 16, background: colors.beige }} />
        <div style={{ marginTop: 28, width: "70%", height: 16, borderRadius: 6, background: colors.beigeDim }} />
        <div style={{ marginTop: 16, width: "50%", height: 16, borderRadius: 6, background: colors.mutedSoft }} />
        <div style={{ position: "absolute", left: 34, bottom: 30, width: "40%", height: 12, borderRadius: 6, background: colors.mutedSoft }} />
      </div>
      {/* spine */}
      <div style={{ position: "absolute", left: -2, top: 0, width: 16, height: 400, borderRadius: 6, background: colors.beigeDeep }} />
    </div>
  </div>
);

// S2 — Upload (5–10s). Drag book → drop into GD → instant upload → dissolve →
// UPLOAD. ASK. UNDERSTAND. snapping in.
export const Scene2Upload: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 12);

  // Drag path: book travels from upper-left to the dropzone (centre) by frame 40.
  const dragP = interpolate(frame, [0, 40], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  const bookX = interpolate(dragP, [0, 1], [-260, 0]);
  const bookY = interpolate(dragP, [0, 1], [-360, -30]);
  const dropped = frame >= 40;

  // Upload progress fills 40→58.
  const prog = interpolate(frame, [42, 58], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });

  // Book dissolves 56→80.
  const dissolve = interpolate(frame, [56, 82], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const bookVisible = dissolve < 1;

  const words: { t: string; at: number }[] = [
    { t: "UPLOAD.", at: 72 },
    { t: "ASK.", at: 94 },
    { t: "UNDERSTAND.", at: 116 },
  ];

  const cardPop = calmSpring(frame, 30, 6);

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      {/* Dropzone card. */}
      {frame < 90 && (
        <GlassCard
          glow={dropped}
          style={{
            position: "absolute",
            width: 620,
            height: 620,
            top: 560,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 28,
            border: `2px dashed ${dropped ? colors.electric : colors.border}`,
            transform: `scale(${interpolate(cardPop, [0, 1], [0.9, 1])})`,
            opacity: interpolate(frame, [78, 90], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          {/* Book sits inside once dropped and dissolves. */}
          {bookVisible && (
            <div
              style={{
                transform: `translate(${dropped ? 0 : bookX}px, ${dropped ? 0 : bookY}px)`,
                opacity: 1 - dissolve,
                filter: `blur(${dissolve * 12}px)`,
              }}
            >
              <Book scale={dropped ? 0.7 : 0.8} />
            </div>
          )}

          {/* Progress bar. */}
          {dropped && (
            <div style={{ width: 440 }}>
              <div style={{ height: 12, borderRadius: 999, background: "rgba(232,220,200,0.14)", overflow: "hidden" }}>
                <div
                  style={{
                    width: `${prog * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${colors.electricDeep}, ${colors.electric})`,
                    boxShadow: `0 0 20px ${colors.glowElectric}`,
                  }}
                />
              </div>
              <div style={{ marginTop: 16, textAlign: "center", fontFamily: fonts.mono, fontSize: 30, color: prog >= 1 ? colors.electric : colors.muted }}>
                {prog >= 1 ? "✓ Ready" : `Uploading… ${Math.round(prog * 100)}%`}
              </div>
            </div>
          )}
        </GlassCard>
      )}

      {/* Dragging pointer. */}
      {frame < 44 && (
        <Pointer x={width / 2 + (dropped ? 40 : bookX + 130)} y={860 + (dropped ? 40 : bookY + 200)} clicking />
      )}

      {/* Book dissolves into knowledge particles. */}
      {frame >= 56 && frame < 110 && (
        <Particles mode="burst" count={110} originY={0.44} progress={interpolate(frame, [56, 100], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} spread={640} color={colors.beige} />
      )}

      {/* Snapping words. */}
      {words.map((w, i) => {
        if (frame < w.at - 2) return null;
        const s = punch(frame, 30, w.at);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              top: 790 + i * 155,
              left: 0,
              right: 0,
              textAlign: "center",
            }}
          >
            <span
              style={{
                display: "inline-block",
                fontFamily: fonts.display,
                fontWeight: 800,
                fontSize: i === 2 ? 100 : 140,
                letterSpacing: -5,
                whiteSpace: "nowrap",
                color: i === 2 ? colors.beige : colors.white,
                opacity: s.opacity,
                transform: s.transform,
                filter: s.filter,
                textShadow: i === 2 ? `0 0 50px ${colors.glow}` : undefined,
              }}
            >
              {w.t}
            </span>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
