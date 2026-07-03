import React from "react";
import {
  AbsoluteFill,
  Sequence,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts, SAFE } from "../theme";
import { PhotoCard } from "../components/PhotoCard";
import { bounceIn, float } from "../motion";

// Scene 5 — Proven on landmark projects · local frames 0–270 (30–39s).
const PROJECTS = [
  { src: "project1.jpg", caption: "Glory Dome, Abuja" },
  { src: "project2.webp", caption: "NCC Headquarters, Abuja" },
  { src: "project3.jpg", caption: "Efab Princhio Estate" },
  { src: "project4.jpg", caption: "Casa Cubana Homes" },
  { src: "project5.jpg", caption: "Casa Cubana Homes" },
];

const SLIDE = 48;
const TOTAL_SLIDES = PROJECTS.length * SLIDE; // 240

const Slide: React.FC<{ src: string; caption: string }> = ({ src, caption }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const op = interpolate(frame, [0, 7, SLIDE - 8, SLIDE], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const enter = bounceIn(frame, fps, 0);
  return (
    <AbsoluteFill style={{ opacity: op, alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          width: SAFE.width,
          height: 1180,
          position: "relative",
          transform: `translateY(${float(frame, 6, 0.05)}px) scale(${0.92 + enter * 0.08})`,
        }}
      >
        <PhotoCard src={src} caption={caption} fallbackLabel={caption} durationInFrames={SLIDE} />
      </div>
    </AbsoluteFill>
  );
};

export const Scene5Projects: React.FC = () => {
  const frame = useCurrentFrame();

  const headOp = interpolate(
    frame,
    [6, 22, TOTAL_SLIDES - 12, TOTAL_SLIDES],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const clientsOp = interpolate(frame, [TOTAL_SLIDES, TOTAL_SLIDES + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.charcoal }}>
      {/* Photo montage */}
      {PROJECTS.map((p, i) => (
        <Sequence key={p.caption + i} from={i * SLIDE} durationInFrames={SLIDE}>
          <Slide src={p.src} caption={p.caption} />
        </Sequence>
      ))}

      {/* Held headline */}
      <div
        style={{
          position: "absolute",
          top: 150,
          left: SAFE.x,
          width: SAFE.width,
          opacity: headOp,
          fontFamily: fonts.sans,
          fontWeight: 800,
          color: colors.white,
          fontSize: 64,
          lineHeight: 1.05,
          textShadow: "0 4px 24px rgba(0,0,0,0.5)",
        }}
      >
        Trusted on Nigeria's <span style={{ color: colors.red }}>landmark projects.</span>
      </div>

      {/* Closing clients line */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: SAFE.width,
            opacity: clientsOp,
            transform: `translateY(${(1 - clientsOp) * 20}px)`,
            textAlign: "center",
            fontFamily: fonts.sans,
            fontWeight: 700,
            color: colors.white,
            fontSize: 48,
            lineHeight: 1.3,
          }}
        >
          Shoprite · Protea & Rockview Hotels
          <br />· Nigeria British School.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
