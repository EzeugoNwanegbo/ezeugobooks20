import React from "react";
import { colors, fonts } from "../../theme";

// Fallback recreation of Practice MCQ (mcq.png) — final graded state.
export const McqMock: React.FC = () => {
  const options = [
    { k: "A", t: "6", state: "idle" as const },
    { k: "B", t: "8", state: "correct" as const },
    { k: "C", t: "14", state: "wrong" as const },
    { k: "D", t: "10", state: "idle" as const },
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
      <div style={{ fontSize: 16, letterSpacing: 3, color: colors.muted }}>
        PRACTICE · MCQ · QUESTION 4 / 10
      </div>
      <h2 style={{ fontSize: 34, lineHeight: 1.35, fontWeight: 600, margin: "18px 0 30px" }}>
        How many carpal bones are there in the human hand?
      </h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {options.map((o) => {
          const isCorrect = o.state === "correct";
          const isWrong = o.state === "wrong";
          const border = isCorrect ? colors.green : isWrong ? colors.red : colors.border;
          const bg = isCorrect
            ? "rgba(34,197,94,0.14)"
            : isWrong
              ? "rgba(239,68,68,0.14)"
              : "transparent";
          const mark = isCorrect ? "✓" : isWrong ? "✗" : o.k;
          const markColor = isCorrect ? colors.green : isWrong ? colors.red : colors.muted;
          return (
            <div
              key={o.k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "18px 22px",
                borderRadius: 14,
                border: `1.5px solid ${border}`,
                background: bg,
                fontSize: 26,
              }}
            >
              <span
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: 999,
                  border: `1.5px solid ${markColor}`,
                  color: markColor,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: 22,
                }}
              >
                {mark}
              </span>
              <span style={{ color: isCorrect ? colors.green : colors.white }}>{o.t}</span>
            </div>
          );
        })}
      </div>

      {/* Explanation */}
      <div
        style={{
          marginTop: 24,
          background: colors.bgSoft,
          border: `1px solid ${colors.border}`,
          borderRadius: 14,
          padding: "20px 22px",
        }}
      >
        <div style={{ fontSize: 16, letterSpacing: 2, color: colors.champagne }}>EXPLANATION</div>
        <p style={{ fontSize: 22, lineHeight: 1.5, color: "#D8D2C6", margin: "12px 0 14px" }}>
          The carpus contains <b>8</b> carpal bones arranged in two rows of four —
          scaphoid, lunate, triquetrum, pisiform, trapezium, trapezoid, capitate
          and hamate.
        </p>
        <div style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.champagne }}>
          Page 32 · Keith_Moore.pdf
        </div>
      </div>
    </div>
  );
};
