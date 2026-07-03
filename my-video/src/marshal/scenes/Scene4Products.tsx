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
import { bounceIn, float, pulse } from "../motion";

// Scene 4 — The product range · local frames 0–390 (17–30s).
// Headline, then each product as a framed card (~78f) with slow zoom,
// ALL-CAPS name + real bullets. MC labels are designed fallback cards;
// Stop Water uses the real bucket render.

type Product = {
  code: string;
  name: string;
  tag: string;
  category: string;
  accent: string;
  bullets: string[];
  imageSrc?: string;
  seal?: string;
};

const PRODUCTS: Product[] = [
  {
    code: "MC40",
    name: "MC40",
    tag: "Interior Floating / Screeding",
    category: "SCREEDING",
    accent: colors.blue,
    bullets: ["Fills gaps in walls", "Ceilings, doors & window frames", "Master adhesion & masonry"],
  },
  {
    code: "MC50",
    name: "MC50",
    tag: "Exterior Floating / Screeding",
    category: "SCREEDING",
    accent: colors.charcoalSoft,
    bullets: ["Built for outside surfaces", "Fills gaps in walls & frames", "Master adhesion & masonry"],
  },
  {
    code: "MC50+",
    name: "MC50+",
    tag: "Extra-Strength Exterior Screeding",
    category: "SCREEDING",
    accent: colors.red,
    seal: "EXTRA STRENGTH",
    bullets: ["Maximum exterior durability", "Reinforced screeding bond", "Weather-tough finish"],
  },
  {
    code: "STOP WATER",
    name: "STOP WATER",
    tag: "Leakage Solution",
    category: "LEAKAGE SOLUTION",
    accent: colors.blue,
    bullets: ["Instant leak protection", "10-year weather & UV guarantee", "Exceptional one-coat coverage"],
  },
];

// Designed label panel for products without real art (MC range).
const DesignedLabel: React.FC<{ p: Product }> = ({ p }) => (
  <AbsoluteFill
    style={{
      borderRadius: 44,
      overflow: "hidden",
      background: `linear-gradient(160deg, ${colors.charcoalSoft}, ${colors.charcoalDeep})`,
      border: `2px solid ${colors.hairline}`,
      boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
    }}
  >
    {/* Top accent banner */}
    <div style={{ height: 26, backgroundColor: p.accent }} />
    <AbsoluteFill
      style={{ alignItems: "center", justifyContent: "center", flexDirection: "column" }}
    >
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 500,
          color: colors.offwhite,
          opacity: 0.6,
          fontSize: 28,
          letterSpacing: 6,
        }}
      >
        MARSHAL
      </div>
      <div
        style={{
          fontFamily: fonts.sans,
          fontWeight: 900,
          color: colors.white,
          // Shrink long names (e.g. "STOP WATER") so they fit the card.
          fontSize: p.code.length > 6 ? 118 : 200,
          lineHeight: 0.92,
          marginTop: 8,
          textAlign: "center",
          padding: "0 30px",
        }}
      >
        {p.code}
      </div>
      <div
        style={{
          marginTop: 18,
          padding: "10px 26px",
          borderRadius: 999,
          backgroundColor: p.accent,
          color: colors.white,
          fontFamily: fonts.sans,
          fontWeight: 700,
          fontSize: 26,
          letterSpacing: 2,
        }}
      >
        {p.category}
      </div>
      {p.seal && (
        <div
          style={{
            position: "absolute",
            top: 60,
            right: 56,
            width: 150,
            height: 150,
            borderRadius: "50%",
            backgroundColor: colors.yellow,
            color: colors.charcoal,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            fontFamily: fonts.sans,
            fontWeight: 800,
            fontSize: 22,
            lineHeight: 1.05,
            transform: "rotate(-12deg)",
            padding: 10,
          }}
        >
          {p.seal}
        </div>
      )}
    </AbsoluteFill>
  </AbsoluteFill>
);

const ProductSlide: React.FC<{ p: Product; dur: number }> = ({ p, dur }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = bounceIn(frame, fps, 0);
  const op = interpolate(
    frame,
    [0, 8, dur - 9, dur],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const bob = float(frame, 7, 0.05);

  return (
    <AbsoluteFill
      style={{ opacity: op, alignItems: "center", justifyContent: "center" }}
    >
      <div style={{ width: SAFE.width }}>
        {/* Framed visual */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: 760,
            transform: `translateY(${(1 - enter) * 60 + bob}px) scale(${(0.88 + enter * 0.12) * pulse(frame, 0.01, 0.06)}) rotate(${(1 - enter) * 4}deg)`,
          }}
        >
          {p.imageSrc ? (
            <PhotoCard src={p.imageSrc} durationInFrames={dur} />
          ) : (
            <DesignedLabel p={p} />
          )}
        </div>

        {/* Name + tag */}
        <div style={{ marginTop: 40, display: "flex", alignItems: "baseline", gap: 22 }}>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 900,
              color: colors.white,
              fontSize: 72,
              letterSpacing: 2,
            }}
          >
            {p.name}
          </div>
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 600,
              color: colors.red,
              fontSize: 34,
            }}
          >
            {p.tag}
          </div>
        </div>

        {/* Bullets */}
        <div style={{ marginTop: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {p.bullets.map((b) => (
            <div key={b} style={{ display: "flex", alignItems: "center", gap: 18 }}>
              <div
                style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: colors.red }}
              />
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontWeight: 500,
                  color: colors.offwhite,
                  fontSize: 36,
                }}
              >
                {b}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const Scene4Products: React.FC = () => {
  const frame = useCurrentFrame();

  const headOp = interpolate(frame, [4, 22, 40, 56], [0, 1, 1, 0.001], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // Small persistent eyebrow after the big headline fades.
  const eyebrowOp = interpolate(frame, [50, 64], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const SLIDE = 78;
  const START = 30;

  // Final "+ rest of range" line.
  const finalAt = START + 4 * SLIDE; // 342
  const finalOp = interpolate(frame, [finalAt, finalAt + 16], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ backgroundColor: colors.charcoal }}>
      {/* Big headline intro */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: SAFE.width,
            opacity: headOp,
            fontFamily: fonts.sans,
            fontWeight: 800,
            color: colors.white,
            fontSize: 88,
            lineHeight: 1.02,
          }}
        >
          One brand.
          <br />
          <span style={{ color: colors.red }}>Every surface.</span>
        </div>
      </AbsoluteFill>

      {/* Eyebrow during the card run */}
      <div
        style={{
          position: "absolute",
          top: 120,
          left: SAFE.x,
          opacity: eyebrowOp * interpolate(frame, [finalAt - 10, finalAt], [1, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          fontFamily: fonts.sans,
          fontWeight: 700,
          color: colors.red,
          fontSize: 30,
          letterSpacing: 4,
        }}
      >
        ONE BRAND. EVERY SURFACE.
      </div>

      {/* Product slides */}
      {PRODUCTS.map((p, i) => (
        <Sequence key={p.code} from={START + i * SLIDE} durationInFrames={SLIDE}>
          <ProductSlide p={p} dur={SLIDE} />
        </Sequence>
      ))}

      {/* Final range line */}
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          style={{
            width: SAFE.width,
            opacity: finalOp,
            transform: `translateY(${(1 - finalOp) * 20}px)`,
            textAlign: "center",
            fontFamily: fonts.sans,
            fontWeight: 700,
            color: colors.white,
            fontSize: 46,
            lineHeight: 1.25,
          }}
        >
          + Silk & Flat Emulsions · Gloss · Epoxy
          <br />· Liquid Marble · Resinous Polish.
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
