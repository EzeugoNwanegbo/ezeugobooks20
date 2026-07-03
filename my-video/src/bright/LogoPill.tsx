import React from "react";
import { staticFile } from "remotion";
import { colors, fonts } from "./theme";
import { SmartShot } from "../components/SmartShot";

// The G&D champagne wordmark sits inside a dark rounded pill so it stays legible
// on the bright background. Falls back to a typeset "G&D" if logo.png is missing.
export const LogoPill: React.FC<{
  height?: number;
  style?: React.CSSProperties;
}> = ({ height = 150, style }) => {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.pill,
        borderRadius: height * 0.32,
        padding: `${height * 0.34}px ${height * 0.5}px`,
        boxShadow: "0 26px 60px -26px rgba(60, 35, 10, 0.55)",
        ...style,
      }}
    >
      <SmartShot
        src={staticFile("logo.png")}
        style={{ width: "auto", height, display: "block" }}
        fallback={
          <span
            style={{
              fontFamily: fonts.display,
              fontWeight: 700,
              fontSize: height,
              color: colors.bg2,
              letterSpacing: 1,
              lineHeight: 1,
            }}
          >
            G&amp;D
          </span>
        }
      />
    </div>
  );
};
