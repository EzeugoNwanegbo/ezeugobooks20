import React from "react";
import { colors, fonts } from "../../theme";

// Fallback recreation of the My Coach / roadmap screen (coach.png).
export const CoachMock: React.FC = () => {
  const steps = [
    { t: "Bones of the wrist & hand", done: true },
    { t: "Muscles & tendons", done: true },
    { t: "Nerve supply", done: false },
    { t: "Clinical: carpal tunnel", done: false },
  ];
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
      <div style={{ fontSize: 16, letterSpacing: 3, color: colors.muted }}>MY COACH</div>
      <h2 style={{ fontFamily: fonts.serif, fontSize: 38, fontWeight: 700, margin: "14px 0 6px" }}>
        Build a roadmap, then practice it.
      </h2>
      <div style={{ fontSize: 19, color: colors.muted, marginBottom: 30 }}>
        From Keith_Moore.pdf · 1,400 pages
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {steps.map((s, i) => (
          <div
            key={s.t}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 18,
              padding: "20px 22px",
              borderRadius: 14,
              border: `1px solid ${colors.border}`,
              background: colors.bgSoft,
            }}
          >
            <span
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                background: s.done ? colors.green : "transparent",
                border: `1.5px solid ${s.done ? colors.green : colors.champagneDim}`,
                color: s.done ? colors.ink : colors.champagneDim,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
                fontSize: 18,
              }}
            >
              {s.done ? "✓" : i + 1}
            </span>
            <span style={{ fontSize: 24, color: s.done ? colors.muted : colors.white }}>{s.t}</span>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: 28,
          textAlign: "center",
          padding: "18px 0",
          borderRadius: 999,
          background: colors.cream,
          color: colors.ink,
          fontSize: 24,
          fontWeight: 700,
        }}
      >
        Practice this roadmap
      </div>
    </div>
  );
};
