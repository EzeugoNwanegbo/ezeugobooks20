import React from "react";
import { useCurrentFrame, interpolate } from "remotion";
import { colors, fonts } from "../theme";

// A leaning stack of textbooks, drawn with CSS. Conveys "buried in books".
const SPINES = [
  { w: 520, h: 70, c: "#3A3531", label: "ANATOMY", rot: -2 },
  { w: 470, h: 64, c: "#4A3F36", label: "PHYSIOLOGY", rot: 1.5 },
  { w: 540, h: 78, c: "#2F2C29", label: "PATHOLOGY", rot: -1 },
  { w: 440, h: 60, c: "#473B33", label: "PHARMACOLOGY", rot: 2.5 },
  { w: 500, h: 72, c: "#39332E", label: "BIOCHEMISTRY", rot: -1.5 },
];

export const BookStack: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const frame = useCurrentFrame();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      {SPINES.map((b, i) => {
        const d = delay + i * 4;
        const op = interpolate(frame, [d, d + 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const y = interpolate(frame, [d, d + 10], [-30, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={i}
            style={{
              width: b.w,
              height: b.h,
              marginTop: i === 0 ? 0 : -2,
              background: `linear-gradient(180deg, ${b.c}, #1c1a18)`,
              border: "1px solid rgba(0,0,0,0.5)",
              borderLeft: `8px solid ${colors.champagneDim}`,
              borderRadius: 6,
              transform: `rotate(${b.rot}deg) translateY(${y}px)`,
              opacity: op,
              boxShadow: "0 14px 30px rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              paddingLeft: 28,
            }}
          >
            <span
              style={{
                fontFamily: fonts.mono,
                fontSize: 22,
                letterSpacing: 4,
                color: "rgba(217,200,163,0.5)",
              }}
            >
              {b.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};
