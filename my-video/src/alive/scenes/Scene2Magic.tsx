import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { sceneOpacity, OUT } from "../motion";
import { Caption, Accent } from "../components/Caption";

// S2 — The magic moment (4–8s). An open book, a light sweep across the page,
// and the hook line. The page edge glows as if waking up.
export const Scene2Magic: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const opacity = sceneOpacity(frame, durationInFrames, 10, 14);

  // Light sweep position (0 -> 1) across the page.
  const sweep = interpolate(frame, [10, 55], [-0.3, 1.3], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  const glow = interpolate(frame, [20, 60], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ opacity, alignItems: "center", justifyContent: "center" }}>
      {/* Open book */}
      <div
        style={{
          position: "absolute",
          top: 380,
          width: 760,
          height: 520,
          display: "flex",
          transform: "perspective(1200px) rotateX(42deg)",
          filter: `drop-shadow(0 40px 60px rgba(0,0,0,0.6))`,
        }}
      >
        {/* left + right pages */}
        {[0, 1].map((p) => (
          <div
            key={p}
            style={{
              flex: 1,
              background: `linear-gradient(${p ? "90deg" : "270deg"}, #efe6d2, #d8cdb4)`,
              borderRadius: p ? "0 14px 14px 0" : "14px 0 0 14px",
              boxShadow: `inset ${p ? "" : "-"}30px 0 50px rgba(0,0,0,0.18)`,
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* faint text lines */}
            {Array.from({ length: 9 }).map((_, i) => (
              <div
                key={i}
                style={{
                  height: 6,
                  margin: "30px 40px",
                  borderRadius: 3,
                  background: "rgba(60,50,40,0.18)",
                  width: i % 3 === 2 ? "55%" : "82%",
                }}
              />
            ))}
            {/* glowing edge */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                boxShadow: `inset 0 0 60px rgba(231,214,172,${0.8 * glow})`,
                borderRadius: "inherit",
              }}
            />
          </div>
        ))}
        {/* light sweep */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${sweep * 100}%`,
            width: 220,
            transform: "translateX(-50%) skewX(-12deg)",
            background:
              "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,250,235,0.75), rgba(255,255,255,0))",
            filter: "blur(6px)",
          }}
        />
      </div>

      <Caption
        delay={26}
        bottom={320}
        size={66}
        lines={[
          <>What if your textbook</>,
          <>
            could <Accent>answer you?</Accent>
          </>,
        ]}
      />
    </AbsoluteFill>
  );
};
