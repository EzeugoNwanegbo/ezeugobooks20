import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { colors, fonts } from "../theme";
import { sceneOpacity, punch, OUT } from "../motion";
import { KineticText } from "../components/KineticText";
import { Caret } from "../components/Cursor";

// Deterministic hash → [0,1).
const rnd = (i: number, s = 1) => {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

// Exploding, swirling book pages. `p` drives the burst; they freeze near p→1.
const Pages: React.FC<{ p: number }> = ({ p }) => {
  const { width, height } = useVideoConfig();
  const cx = width / 2;
  const cy = height / 2;
  const e = interpolate(p, [0, 1], [0, 1], { extrapolateRight: "clamp", easing: OUT });
  return (
    <AbsoluteFill>
      {Array.from({ length: 26 }, (_, i) => {
        const ang = rnd(i, 1) * Math.PI * 2;
        const dist = (0.35 + rnd(i, 2) * 0.75) * Math.max(width, height) * 0.62;
        const swirl = (1 - e) * 0 + e * (rnd(i, 5) - 0.5) * 1.4;
        const x = cx + Math.cos(ang + swirl) * dist * e;
        const y = cy + Math.sin(ang + swirl) * dist * e - e * 60;
        const rot = (rnd(i, 3) - 0.5) * 220 * e;
        const w = 120 + rnd(i, 4) * 90;
        const h = w * 1.34;
        const a = interpolate(p, [0, 0.15, 0.85, 1], [0, 1, 1, 0.5]);
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: x - w / 2,
              top: y - h / 2,
              width: w,
              height: h,
              background: "linear-gradient(160deg, #F6F2EA 0%, #D9D2C4 100%)",
              borderRadius: 6,
              transform: `rotate(${rot}deg)`,
              opacity: a,
              boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
              filter: e > 0.9 ? undefined : `blur(${(1 - e) * 3}px)`,
            }}
          >
            {/* text lines on the page */}
            {[0.28, 0.42, 0.56, 0.7, 0.84].map((ly, k) => (
              <div
                key={k}
                style={{
                  position: "absolute",
                  left: "14%",
                  top: `${ly * 100}%`,
                  width: `${52 + rnd(i * 5 + k, 8) * 20}%`,
                  height: 4,
                  background: colors.mutedSoft,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
        );
      })}
    </AbsoluteFill>
  );
};

// S1 — Hook (0–5s). Cursor → sentence slams in → pages explode → "WHY?" punches.
export const Scene1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 4, 12);

  // Beat drop shockwave when WHY? lands (~frame 100).
  const shock = interpolate(frame, [100, 118], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  const flash = interpolate(frame, [100, 104, 118], [0, 0.5, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const whyStyle = punch(frame, 30, 100);
  const sentenceFade = interpolate(frame, [92, 104], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      {/* Pages explode from ~frame 46, freeze by ~92. */}
      {frame > 40 && (
        <Pages p={interpolate(frame, [46, 96], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })} />
      )}

      {/* Blinking cursor before the text slams (0–22). */}
      {frame < 24 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontFamily: fonts.mono, fontSize: 46, color: colors.muted }}>
            {frame > 8 ? "searching" : ""}
          </span>
          <Caret height={64} />
        </div>
      )}

      {/* Sentence slams in word-by-word (22–92). */}
      {frame >= 22 && (
        <div style={{ opacity: sentenceFade, padding: "0 70px" }}>
          <KineticText
            text="Still searching through 2,000 pages…"
            verb="slam"
            delay={22}
            stagger={4}
            size={78}
            weight={700}
            color={colors.white}
            letterSpacing={-1}
            lineHeight={1.05}
          />
        </div>
      )}

      {/* Beat-drop flash. */}
      <AbsoluteFill style={{ background: colors.beige, opacity: flash, mixBlendMode: "overlay" }} />

      {/* Shockwave ring. */}
      {shock > 0 && (
        <div
          style={{
            position: "absolute",
            width: 200 + shock * 1400,
            height: 200 + shock * 1400,
            borderRadius: "50%",
            border: `${(1 - shock) * 10 + 1}px solid ${colors.beige}`,
            opacity: (1 - shock) * 0.7,
          }}
        />
      )}

      {/* "WHY?" punches through on the beat (100+). */}
      {frame >= 98 && (
        <div
          style={{
            position: "absolute",
            fontFamily: fonts.display,
            fontWeight: 800,
            fontSize: 400,
            letterSpacing: -12,
            color: colors.beige,
            opacity: whyStyle.opacity,
            transform: whyStyle.transform,
            filter: whyStyle.filter,
            textShadow: `0 0 60px ${colors.glow}`,
          }}
        >
          WHY?
        </div>
      )}
    </AbsoluteFill>
  );
};
