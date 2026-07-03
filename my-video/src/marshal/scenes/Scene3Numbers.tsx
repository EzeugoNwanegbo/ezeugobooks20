import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { pop, bounceIn, punch } from "../motion";

// Scene 3 — Trust in numbers · local frames 0–150 (12–17s).
const STATS = [
  { target: 27, suffix: "+", label: "Years" },
  { target: 150, suffix: "+", label: "Painters" },
  { target: 5, suffix: "", label: "Cities" },
];

export const Scene3Numbers: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const START = 4;
  const STEP = 12; // rapid-fire

  const sloganAt = 78;
  const sloganPop = bounceIn(frame, fps, sloganAt);
  const underline = interpolate(frame, [sloganAt + 6, sloganAt + 22], [0, SAFE.width * 0.6], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.charcoal,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div style={{ width: SAFE.width, display: "flex", flexDirection: "column", gap: 64 }}>
        {STATS.map((s, i) => {
          const begin = START + i * STEP;
          const grow = interpolate(frame, [begin, begin + 18], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const value = Math.round(grow * s.target);
          const p = pop(frame, fps, begin);
          const settlePunch = punch(frame, begin + 18, 0.16, 8);
          return (
            <div
              key={s.label}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 28,
                opacity: Math.min(1, p * 1.5),
                transform: `translateX(${(1 - p) * -50}px)`,
              }}
            >
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontWeight: 900,
                  color: colors.red,
                  fontSize: 184,
                  lineHeight: 0.9,
                  fontVariantNumeric: "tabular-nums",
                  transform: `scale(${settlePunch})`,
                  transformOrigin: "left center",
                }}
              >
                {value}
                {s.suffix}
              </div>
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontWeight: 700,
                  color: colors.white,
                  fontSize: 56,
                }}
              >
                {s.label}
              </div>
            </div>
          );
        })}

        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            color: colors.offwhite,
            opacity: interpolate(frame, [52, 64], [0, 0.7], { extrapolateRight: "clamp" }),
            fontSize: 30,
            letterSpacing: 1.5,
            marginTop: -32,
          }}
        >
          Abuja · Enugu · Lagos · Port Harcourt · Kaduna
        </div>

        {/* Slogan stamp */}
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 800,
              color: colors.white,
              fontSize: 64,
              letterSpacing: 1,
              opacity: Math.min(1, sloganPop * 1.5),
              transform: `scale(${0.8 + sloganPop * 0.2}) rotate(${(1 - sloganPop) * -3}deg)`,
              transformOrigin: "left center",
            }}
          >
            Quality Comes First.
          </div>
          <div
            style={{
              width: underline,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.red,
              marginTop: 18,
            }}
          />
        </div>
      </div>
    </AbsoluteFill>
  );
};
