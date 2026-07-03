import React from "react";
import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { Logo } from "../components/Logo";
import { pop, bounceIn, float, pulse } from "../motion";

// Scene 7 — Close + CTA · local frames 0–90 (42–45s).
export const Scene7CTA: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const logoPop = bounceIn(frame, fps, 0);
  const settle = Math.max(0, frame - 24);
  const sloganPop = bounceIn(frame, fps, 12);
  const lineW = interpolate(frame, [22, 40], [0, SAFE.width * 0.5], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const contacts = ["marshalpaints.com", "+234 803 787 7680", "@marshalpaints"];

  return (
    <AbsoluteFill
      style={{
        backgroundColor: colors.charcoal,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
        }}
      >
        <div
          style={{
            transform: `translateY(${(1 - logoPop) * 40 + float(settle, 8, 0.05)}px) scale(${(0.8 + logoPop * 0.2) * pulse(settle, 0.012, 0.07)})`,
            opacity: Math.min(1, logoPop * 1.5),
          }}
        >
          <Logo width={560} />
        </div>

        <div
          style={{
            marginTop: 64,
            opacity: Math.min(1, sloganPop * 1.5),
            transform: `translateY(${(1 - sloganPop) * 26}px) scale(${0.85 + sloganPop * 0.15})`,
            fontFamily: fonts.sans,
            fontWeight: 800,
            color: colors.white,
            fontSize: 60,
            letterSpacing: 1,
            textAlign: "center",
          }}
        >
          We Build, <span style={{ color: colors.red }}>Your Dream.</span>
        </div>

        <div
          style={{
            width: lineW,
            height: 6,
            borderRadius: 3,
            backgroundColor: colors.red,
            marginTop: 40,
            marginBottom: 40,
          }}
        />

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 14,
          }}
        >
          {contacts.map((c, i) => {
            const cp = pop(frame, fps, 38 + i * 6);
            return (
              <div
                key={c}
                style={{
                  opacity: Math.min(1, cp * 1.5),
                  transform: `translateY(${(1 - cp) * 18}px)`,
                  fontFamily: fonts.sans,
                  fontWeight: 500,
                  color: colors.offwhite,
                  fontSize: 38,
                  letterSpacing: 1,
                }}
              >
                {c}
              </div>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
};
