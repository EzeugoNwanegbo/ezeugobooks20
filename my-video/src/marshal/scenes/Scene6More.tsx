import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { pop, bounceIn } from "../motion";

// Scene 6 — More than paint · local frames 0–90 (39–42s).
const ITEMS = [
  "Paints",
  "Screeding",
  "Epoxy",
  "Stop-Water",
  "Interior Design",
  "Site & Structural Building",
  "Nationwide delivery, on schedule",
];

export const Scene6More: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headPop = bounceIn(frame, fps, 0);
  const headOp = interpolate(frame, [0, 10], [0, 1], {
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
      <div style={{ width: SAFE.width }}>
        <div
          style={{
            opacity: headOp,
            transform: `translateY(${(1 - headPop) * 24}px) scale(${0.9 + headPop * 0.1})`,
            transformOrigin: "left center",
            fontFamily: fonts.sans,
            fontWeight: 800,
            color: colors.white,
            fontSize: 72,
            marginBottom: 56,
          }}
        >
          More than <span style={{ color: colors.red }}>paint.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {ITEMS.map((it, i) => {
            const s = pop(frame, fps, 12 + i * 5);
            const last = i === ITEMS.length - 1;
            return (
              <div
                key={it}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  opacity: Math.min(1, s * 1.5),
                  transform: `translateX(${(1 - s) * -70}px)`,
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    backgroundColor: colors.red,
                    transform: `rotate(${45 + (1 - s) * 90}deg) scale(${0.4 + s * 0.6})`,
                    flexShrink: 0,
                  }}
                />
                <div
                  style={{
                    fontFamily: fonts.sans,
                    fontWeight: last ? 700 : 600,
                    color: last ? colors.red : colors.white,
                    fontSize: last ? 46 : 52,
                  }}
                >
                  {it}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
