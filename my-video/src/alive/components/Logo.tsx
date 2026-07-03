import React from "react";
import { colors, fonts } from "../theme";

// GD1 wordmark, rendered in code (no image asset). Serif "GD" + mono "1" badge.
export const Logo: React.FC<{ size?: number; glow?: number }> = ({
  size = 120,
  glow = 0,
}) => {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: size * 0.16 }}>
      <span
        style={{
          fontFamily: fonts.serif,
          fontWeight: 800,
          fontSize: size,
          color: colors.cream,
          letterSpacing: -2,
          textShadow: glow
            ? `0 0 ${glow * 50}px rgba(231,214,172,${0.7 * glow})`
            : "none",
        }}
      >
        GD
      </span>
      <span
        style={{
          fontFamily: fonts.mono,
          fontWeight: 600,
          fontSize: size * 0.62,
          color: colors.bg,
          background: `linear-gradient(135deg, ${colors.gold}, ${colors.champagneDim})`,
          borderRadius: size * 0.18,
          padding: `${size * 0.06}px ${size * 0.22}px`,
          lineHeight: 1,
          boxShadow: glow
            ? `0 0 ${glow * 60}px rgba(231,214,172,${0.6 * glow})`
            : "0 8px 30px rgba(0,0,0,0.4)",
        }}
      >
        1
      </span>
    </div>
  );
};
