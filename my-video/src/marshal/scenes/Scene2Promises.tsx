import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { ShieldIcon, RollerIcon, LeafIcon, HandshakeIcon } from "../components/Icons";
import { pop, bounceIn, pulse } from "../motion";

// Scene 2 — Four promises · local frames 0–210 (5–12s).
const PROMISES = [
  { Icon: ShieldIcon, label: "DURABILITY", sub: "Coatings that last." },
  { Icon: RollerIcon, label: "QUALITY", sub: "Quality comes first." },
  { Icon: LeafIcon, label: "SAFETY", sub: "Safe, low-odour finishes." },
  { Icon: HandshakeIcon, label: "TRUST", sub: "Nigeria's trusted name since 1997." },
];

export const Scene2Promises: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headPop = bounceIn(frame, fps, 2);

  const START = 20;
  const STEP = 24; // snappier cadence

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
            transform: `translateY(${(1 - headPop) * 30}px) scale(${0.9 + headPop * 0.1})`,
            opacity: interpolate(frame, [2, 14], [0, 1], { extrapolateRight: "clamp" }),
            fontFamily: fonts.sans,
            fontWeight: 800,
            color: colors.white,
            fontSize: 76,
            lineHeight: 1.05,
            marginBottom: 70,
          }}
        >
          Built on <span style={{ color: colors.red }}>four promises.</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 40 }}>
          {PROMISES.map(({ Icon, label, sub }, i) => {
            const s = pop(frame, fps, START + i * STEP);
            const dir = i % 2 === 0 ? -1 : 1;
            const iconSettle = Math.max(0, frame - (START + i * STEP + 12));
            return (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 36,
                  opacity: Math.min(1, s * 1.4),
                  transform: `translateX(${(1 - s) * 70 * dir}px)`,
                }}
              >
                <div
                  style={{
                    width: 118,
                    height: 118,
                    borderRadius: 26,
                    flexShrink: 0,
                    border: `2px solid ${colors.hairline}`,
                    backgroundColor: colors.charcoalDeep,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transform: `scale(${0.6 + s * 0.4}) rotate(${(1 - s) * -18}deg)`,
                  }}
                >
                  <div style={{ transform: `scale(${pulse(iconSettle, 0.04, 0.1, i)})` }}>
                    <Icon size={70} />
                  </div>
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: fonts.sans,
                      fontWeight: 800,
                      color: colors.white,
                      fontSize: 54,
                      letterSpacing: 3,
                    }}
                  >
                    {label}
                  </div>
                  <div
                    style={{
                      fontFamily: fonts.sans,
                      fontWeight: 500,
                      color: colors.offwhite,
                      opacity: 0.78,
                      fontSize: 34,
                      marginTop: 4,
                    }}
                  >
                    {sub}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
