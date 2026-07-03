import React from "react";
import { colors, fonts } from "../../theme";

// Fallback recreation of the Practice setup screen (practice.png).
export const PracticeMock: React.FC = () => {
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
      <div style={{ fontSize: 16, letterSpacing: 3, color: colors.muted }}>PRACTICE</div>
      <h2 style={{ fontFamily: fonts.serif, fontSize: 40, fontWeight: 700, margin: "14px 0 6px" }}>
        Anatomy of the Hand
      </h2>
      <div style={{ fontSize: 20, color: colors.muted, marginBottom: 28 }}>Pick a topic to drill</div>

      <div style={{ fontSize: 15, letterSpacing: 2, color: colors.champagne, marginBottom: 12 }}>
        FORMAT
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {[
          { t: "MCQ", on: true },
          { t: "Essay", on: false },
          { t: "Flash cards", on: false },
          { t: "Exam mode", on: false },
        ].map((f) => (
          <div
            key={f.t}
            style={{
              padding: "20px 22px",
              borderRadius: 14,
              border: `1.5px solid ${f.on ? colors.champagne : colors.border}`,
              background: f.on ? "rgba(201,188,163,0.10)" : "transparent",
              fontSize: 24,
              color: f.on ? colors.champagne : colors.white,
              fontWeight: f.on ? 600 : 400,
            }}
          >
            {f.t}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, marginTop: 26 }}>
        <div style={{ fontSize: 15, letterSpacing: 2, color: colors.champagne }}>MODE</div>
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 12 }}>
        {["Learning", "Exam"].map((m, i) => (
          <div
            key={m}
            style={{
              padding: "12px 22px",
              borderRadius: 999,
              border: `1px solid ${colors.border}`,
              background: i === 0 ? colors.cream : "transparent",
              color: i === 0 ? colors.ink : colors.muted,
              fontSize: 20,
              fontWeight: i === 0 ? 700 : 400,
            }}
          >
            {m}
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 32,
          textAlign: "center",
          padding: "20px 0",
          borderRadius: 999,
          background: colors.cream,
          color: colors.ink,
          fontSize: 26,
          fontWeight: 700,
        }}
      >
        Start practice
      </div>
    </div>
  );
};
