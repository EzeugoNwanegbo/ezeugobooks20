import React from "react";
import { colors, fonts } from "../../theme";

// Fallback recreation of Pinpoint Chat (chat.png).
export const ChatMock: React.FC = () => {
  return (
    <div
      style={{
        width: "100%",
        background: colors.bg,
        padding: "44px 52px 52px",
        fontFamily: fonts.sans,
        color: colors.white,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          color: colors.champagne,
          fontFamily: fonts.serif,
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: 1,
        }}
      >
        G&amp;D
        <span style={{ fontFamily: fonts.sans, fontSize: 16, color: colors.muted, letterSpacing: 3 }}>
          PINPOINT CHAT
        </span>
      </div>

      {/* Question bubble */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 36 }}>
        <div
          style={{
            background: "rgba(201,188,163,0.12)",
            border: `1px solid ${colors.border}`,
            borderRadius: "18px 18px 4px 18px",
            padding: "16px 24px",
            fontSize: 26,
            color: colors.white,
          }}
        >
          anatomy of the hand
        </div>
      </div>

      {/* Answer card */}
      <div
        style={{
          marginTop: 28,
          background: colors.bgSoft,
          border: `1px solid ${colors.border}`,
          borderRadius: 18,
          padding: "26px 28px",
        }}
      >
        <div
          style={{
            display: "inline-block",
            fontFamily: fonts.mono,
            fontSize: 14,
            letterSpacing: 2,
            color: colors.ink,
            background: colors.champagne,
            padding: "5px 12px",
            borderRadius: 6,
          }}
        >
          FROM YOUR FILES
        </div>
        <p style={{ fontSize: 24, lineHeight: 1.5, color: "#D8D2C6", margin: "20px 0 0" }}>
          The hand is the distal part of the upper limb, comprising the carpus,
          metacarpus and phalanges. Its intrinsic and extrinsic muscles enable
          both power and precision grip.
        </p>
        <div
          style={{
            marginTop: 22,
            paddingTop: 18,
            borderTop: `1px solid ${colors.border}`,
            fontFamily: fonts.mono,
            fontSize: 18,
            color: colors.champagne,
          }}
        >
          Clinically Oriented Anatomy — Keith Moore · pages 1286–1287
        </div>
      </div>

      {/* Mode chips */}
      <div style={{ display: "flex", gap: 12, marginTop: 26, flexWrap: "wrap" }}>
        {["Simplified", "Detailed", "Storytelling", "Visuals", "Find connections"].map((m, i) => (
          <div
            key={m}
            style={{
              fontSize: 18,
              padding: "10px 18px",
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              color: i === 1 ? colors.ink : colors.muted,
              background: i === 1 ? colors.cream : "transparent",
            }}
          >
            {m}
          </div>
        ))}
      </div>
    </div>
  );
};
