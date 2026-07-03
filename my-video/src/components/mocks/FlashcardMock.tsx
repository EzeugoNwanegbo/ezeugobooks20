import React from "react";
import { colors, fonts } from "../../theme";

// Fallback recreation of a Flash card answer side (flashcard.png).
export const FlashcardMock: React.FC = () => {
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
      <div style={{ fontSize: 16, letterSpacing: 3, color: colors.muted }}>
        FLASH CARDS · 7 / 24
      </div>

      <div
        style={{
          marginTop: 22,
          minHeight: 360,
          background: colors.bgSoft,
          border: `1px solid ${colors.border}`,
          borderRadius: 22,
          padding: "32px 30px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ fontSize: 16, letterSpacing: 2, color: colors.champagne }}>ANSWER</div>
        <div
          style={{
            fontFamily: fonts.serif,
            fontSize: 36,
            fontWeight: 700,
            margin: "22px 0 14px",
            color: colors.white,
          }}
        >
          Long Flexor Tendons
        </div>
        <p style={{ fontSize: 23, lineHeight: 1.5, color: "#D8D2C6", margin: 0 }}>
          Flexor digitorum superficialis &amp; profundus pass through the carpal
          tunnel to insert on the middle and distal phalanges, flexing the digits.
        </p>
        <div
          style={{
            marginTop: "auto",
            paddingTop: 18,
            fontFamily: fonts.mono,
            fontSize: 17,
            color: colors.champagne,
          }}
        >
          p. 1291 · Keith_Moore.pdf
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 22 }}>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            padding: "16px 0",
            borderRadius: 999,
            border: `1.5px solid ${colors.red}`,
            color: colors.red,
            fontSize: 22,
            fontWeight: 600,
          }}
        >
          Missed
        </div>
        <div
          style={{
            flex: 1,
            textAlign: "center",
            padding: "16px 0",
            borderRadius: 999,
            background: colors.cream,
            color: colors.ink,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          Got it
        </div>
      </div>
    </div>
  );
};
