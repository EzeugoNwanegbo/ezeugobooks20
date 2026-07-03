import React from "react";
import { colors } from "../theme";

// A floating browser/device frame for the wide desktop screenshots.
// Rounded corners, thin champagne border, soft drop shadow, faux traffic-light chrome.
export const DeviceFrame: React.FC<{
  children: React.ReactNode;
  width?: number;
  style?: React.CSSProperties;
  showChrome?: boolean;
  url?: string;
}> = ({ children, width = 980, style, showChrome = true, url = "gd1.online" }) => {
  return (
    <div
      style={{
        width,
        borderRadius: 28,
        overflow: "hidden",
        background: "#161413",
        border: `1px solid ${colors.border}`,
        boxShadow:
          "0 40px 120px rgba(0,0,0,0.65), 0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(201,188,163,0.06)",
        ...style,
      }}
    >
      {showChrome ? (
        <div
          style={{
            height: 56,
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "0 22px",
            background: "rgba(20,18,17,0.95)",
            borderBottom: `1px solid ${colors.border}`,
          }}
        >
          <div style={{ display: "flex", gap: 9 }}>
            {["#3A3631", "#3A3631", "#3A3631"].map((c, i) => (
              <div
                key={i}
                style={{ width: 13, height: 13, borderRadius: 999, background: c }}
              />
            ))}
          </div>
          <div
            style={{
              flex: 1,
              height: 30,
              borderRadius: 999,
              background: "rgba(10,10,10,0.7)",
              border: `1px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              paddingLeft: 18,
              color: colors.champagneDim,
              fontFamily: "monospace",
              fontSize: 16,
              letterSpacing: 0.5,
            }}
          >
            {url}
          </div>
        </div>
      ) : null}
      <div style={{ position: "relative", lineHeight: 0 }}>{children}</div>
    </div>
  );
};
