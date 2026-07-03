import React from "react";
import { Img, staticFile } from "remotion";
import { colors, fonts } from "../theme";

// Marshal mark. Uses the real brand logo (cropped from the official artwork)
// presented as a rounded "printed card" — the wordmark is dark, so it sits on
// its own light background rather than directly on charcoal. Falls back to a
// clean vector recreation if the image is unavailable.

const LOGO_ASPECT = 700 / 528;

const Star: React.FC<{ cx: number; cy: number; r: number; fill: string }> = ({
  cx,
  cy,
  r,
  fill,
}) => {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (Math.PI / 5) * i - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.42;
    pts.push(`${cx + rad * Math.cos(ang)},${cy + rad * Math.sin(ang)}`);
  }
  return <polygon points={pts.join(" ")} fill={fill} />;
};

const VectorLogo: React.FC<{ width: number; ink: string }> = ({ width, ink }) => {
  const stars = [-2, -1, 0, 1, 2];
  return (
    <div style={{ width, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg viewBox="0 0 520 200" width={width} style={{ display: "block" }}>
        <ellipse cx="260" cy="100" rx="250" ry="86" fill={colors.red} />
        <ellipse cx="260" cy="100" rx="170" ry="40" fill={colors.charcoal} />
        {stars.map((s, i) => (
          <Star key={i} cx={260 + s * 64} cy={100} r={26} fill={ink} />
        ))}
      </svg>
      <div style={{ marginTop: width * 0.06, textAlign: "center", lineHeight: 1 }}>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 800,
            color: ink,
            fontSize: width * 0.135,
          }}
        >
          MARSHAL PAINTS
        </div>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 500,
            color: ink,
            opacity: 0.82,
            fontSize: width * 0.045,
            letterSpacing: width * 0.02,
            marginTop: width * 0.022,
          }}
        >
          AND CHEMICAL INDUSTRY LIMITED
        </div>
      </div>
    </div>
  );
};

export const Logo: React.FC<{
  width?: number;
  ink?: string;
}> = ({ width = 520, ink = colors.white }) => {
  const [broken, setBroken] = React.useState(false);

  if (broken) {
    return <VectorLogo width={width} ink={ink} />;
  }

  return (
    <div
      style={{
        width,
        height: width / LOGO_ASPECT,
        borderRadius: width * 0.05,
        overflow: "hidden",
        backgroundColor: colors.offwhite,
        boxShadow: "0 30px 70px rgba(0,0,0,0.45)",
        border: `1px solid rgba(0,0,0,0.06)`,
      }}
    >
      <Img
        src={staticFile("logo.png")}
        onError={() => setBroken(true)}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
};
