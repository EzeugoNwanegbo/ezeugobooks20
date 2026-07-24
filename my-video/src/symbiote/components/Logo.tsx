import React from "react";
import { colors, fonts } from "../theme";

// GD wordmark, generated in code. A beige rounded tile holding "GD" with a soft
// glow, matching the matte-black + beige brand.
export const Logo: React.FC<{ size?: number; glow?: number }> = ({ size = 200, glow = 1 }) => (
  <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: size * 0.14 }}>
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: `linear-gradient(150deg, ${colors.beige} 0%, #D8C9AE 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 0 ${60 * glow}px ${colors.glow}, 0 24px 60px rgba(0,0,0,0.55), inset 0 2px 0 rgba(255,255,255,0.5)`,
      }}
    >
      <span
        style={{
          fontFamily: fonts.display,
          fontWeight: 800,
          fontSize: size * 0.46,
          letterSpacing: -2,
          color: colors.bg,
        }}
      >
        GD
      </span>
    </div>
  </div>
);
