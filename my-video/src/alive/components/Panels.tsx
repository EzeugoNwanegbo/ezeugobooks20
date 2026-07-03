import React from "react";
import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { calmSpring, popSpring, typed, OUT } from "../motion";
import { colors, fonts } from "../theme";

// ----- Shared floating UI frame (a clean dark product surface) -------------
export const Frame: React.FC<{
  children: React.ReactNode;
  width?: number;
  height?: number;
  title?: string;
  delay?: number;
}> = ({ children, width = 760, height = 980, title = "GD1", delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = calmSpring(frame, fps, delay);
  const op = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        width,
        height,
        transform: `translateY(${interpolate(s, [0, 1], [60, 0])}px) scale(${interpolate(
          s,
          [0, 1],
          [0.94, 1],
        )})`,
        opacity: op,
        background: `linear-gradient(180deg, ${colors.panel}, ${colors.bgSoft})`,
        border: `1px solid ${colors.border}`,
        borderRadius: 44,
        boxShadow:
          "0 50px 120px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.04)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          height: 86,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 36px",
          borderBottom: `1px solid ${colors.borderSoft}`,
        }}
      >
        <span
          style={{
            fontFamily: fonts.serif,
            fontWeight: 800,
            fontSize: 34,
            color: colors.cream,
            letterSpacing: -1,
          }}
        >
          {title}
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          {[colors.champagneDim, colors.champagneDim, colors.champagne].map((c, i) => (
            <div
              key={i}
              style={{ width: 12, height: 12, borderRadius: 6, background: c, opacity: 0.7 }}
            />
          ))}
        </div>
      </div>
      <div style={{ flex: 1, padding: 36, position: "relative" }}>{children}</div>
    </div>
  );
};

// ----- Chat panel -----------------------------------------------------------
export const ChatPanel: React.FC<{
  prompt: string;
  answer: string[];
  source?: string;
  delay?: number;
}> = ({ prompt, answer, source = "Guyton_Physiology.pdf · p.214", delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const promptText = typed(frame, fps, prompt, 30, delay + 6);
  const answerStart = delay + 6 + Math.round((prompt.length / 30) * fps) + 10;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 26 }}>
      {/* User prompt bubble (right) */}
      <Bubble side="right" delay={delay}>
        <span style={{ fontFamily: fonts.mono, fontSize: 30, color: colors.bg }}>
          {promptText}
          <Cursor on={promptText.length < prompt.length} dark />
        </span>
      </Bubble>

      {/* AI answer bubble (left) */}
      <Bubble side="left" delay={answerStart - 4} grow>
        {answer.map((line, i) => {
          const t = typed(frame, fps, line, 42, answerStart + i * 10);
          return (
            <div
              key={i}
              style={{
                fontFamily: fonts.sans,
                fontSize: 29,
                lineHeight: 1.45,
                color: colors.cream,
                marginBottom: 8,
              }}
            >
              {t}
            </div>
          );
        })}
        {/* Source citation chip */}
        <SourceChip text={source} delay={answerStart + answer.length * 10 + 6} />
      </Bubble>
    </div>
  );
};

const Bubble: React.FC<{
  side: "left" | "right";
  delay: number;
  grow?: boolean;
  children: React.ReactNode;
}> = ({ side, delay, grow, children }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = popSpring(frame, fps, delay);
  const op = interpolate(frame, [delay, delay + 7], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const right = side === "right";
  return (
    <div
      style={{
        alignSelf: right ? "flex-end" : "flex-start",
        maxWidth: grow ? "92%" : "78%",
        opacity: op,
        transform: `translateY(${interpolate(s, [0, 1], [24, 0])}px) scale(${interpolate(
          s,
          [0, 1],
          [0.9, 1],
        )})`,
        background: right
          ? `linear-gradient(135deg, ${colors.gold}, ${colors.champagne})`
          : colors.panelSoft,
        border: right ? "none" : `1px solid ${colors.borderSoft}`,
        borderRadius: 28,
        borderBottomRightRadius: right ? 8 : 28,
        borderBottomLeftRadius: right ? 28 : 8,
        padding: "22px 28px",
      }}
    >
      {children}
    </div>
  );
};

const SourceChip: React.FC<{ text: string; delay: number }> = ({ text, delay }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [delay, delay + 10], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  return (
    <div
      style={{
        marginTop: 16,
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        opacity: op,
        background: "rgba(52,211,153,0.12)",
        border: `1px solid rgba(52,211,153,0.4)`,
        borderRadius: 999,
        padding: "8px 16px",
      }}
    >
      <div style={{ width: 10, height: 10, borderRadius: 5, background: colors.green }} />
      <span style={{ fontFamily: fonts.mono, fontSize: 22, color: colors.green }}>{text}</span>
    </div>
  );
};

const Cursor: React.FC<{ on: boolean; dark?: boolean }> = ({ on, dark }) => {
  const frame = useCurrentFrame();
  if (!on) return null;
  const blink = Math.floor(frame / 8) % 2 === 0;
  return (
    <span style={{ opacity: blink ? 1 : 0, color: dark ? colors.bg : colors.champagne }}>▍</span>
  );
};

// ----- MCQ panel ------------------------------------------------------------
export const McqPanel: React.FC<{
  question: string;
  options: string[];
  correct: number;
  delay?: number;
}> = ({ question, options, correct, delay = 0 }) => {
  const frame = useCurrentFrame();
  const revealAt = delay + 40; // when the correct answer turns green

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22, height: "100%" }}>
      <FadeUp delay={delay}>
        <div
          style={{
            fontFamily: fonts.sans,
            fontWeight: 700,
            fontSize: 34,
            lineHeight: 1.3,
            color: colors.white,
          }}
        >
          {question}
        </div>
      </FadeUp>
      {options.map((opt, i) => {
        const isCorrect = i === correct;
        const showState = frame >= revealAt && isCorrect;
        return (
          <FadeUp key={i} delay={delay + 10 + i * 6}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 18,
                padding: "22px 26px",
                borderRadius: 22,
                background: showState ? "rgba(52,211,153,0.14)" : colors.panelSoft,
                border: `1.5px solid ${showState ? colors.green : colors.borderSoft}`,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: showState ? colors.green : "transparent",
                  border: showState ? "none" : `1.5px solid ${colors.champagneDim}`,
                  fontFamily: fonts.mono,
                  fontWeight: 600,
                  fontSize: 26,
                  color: showState ? colors.bg : colors.champagne,
                }}
              >
                {showState ? "✓" : String.fromCharCode(65 + i)}
              </div>
              <span
                style={{
                  fontFamily: fonts.sans,
                  fontSize: 30,
                  color: showState ? colors.cream : colors.muted,
                  fontWeight: showState ? 600 : 400,
                }}
              >
                {opt}
              </span>
            </div>
          </FadeUp>
        );
      })}
    </div>
  );
};

// ----- Flashcard panel (front -> flip -> back) ------------------------------
export const FlashcardPanel: React.FC<{
  term: string;
  definition: string;
  delay?: number;
}> = ({ term, definition, delay = 0 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const flipAt = delay + 36;
  const flip = interpolate(frame, [flipAt, flipAt + 16], [0, 180], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  const showBack = flip > 90;
  const s = popSpring(frame, fps, delay);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        perspective: 1400,
      }}
    >
      <div
        style={{
          width: "92%",
          height: 420,
          transformStyle: "preserve-3d",
          transform: `rotateY(${flip}deg) scale(${interpolate(s, [0, 1], [0.9, 1])})`,
          position: "relative",
        }}
      >
        <CardFace visible={!showBack} bg={colors.panelSoft}>
          <span style={{ fontFamily: fonts.mono, fontSize: 24, color: colors.champagneDim }}>
            TERM
          </span>
          <span
            style={{
              fontFamily: fonts.serif,
              fontWeight: 700,
              fontSize: 64,
              color: colors.cream,
              textAlign: "center",
            }}
          >
            {term}
          </span>
        </CardFace>
        <CardFace visible={showBack} bg={`linear-gradient(135deg, #20201c, ${colors.panel})`} back>
          <span style={{ fontFamily: fonts.mono, fontSize: 24, color: colors.champagne }}>
            DEFINITION
          </span>
          <span
            style={{
              fontFamily: fonts.sans,
              fontSize: 34,
              lineHeight: 1.4,
              color: colors.cream,
              textAlign: "center",
            }}
          >
            {definition}
          </span>
        </CardFace>
      </div>
    </div>
  );
};

const CardFace: React.FC<{
  children: React.ReactNode;
  visible: boolean;
  bg: string;
  back?: boolean;
}> = ({ children, visible, bg, back }) => (
  <div
    style={{
      position: "absolute",
      inset: 0,
      backfaceVisibility: "hidden",
      transform: back ? "rotateY(180deg)" : "none",
      background: bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 36,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 24,
      padding: 50,
      opacity: visible ? 1 : 0,
    }}
  >
    {children}
  </div>
);

// ----- Roadmap panel (adaptive study plan) ----------------------------------
export const RoadmapPanel: React.FC<{ delay?: number }> = ({ delay = 0 }) => {
  const items = [
    { d: "Day 1", t: "Cardiac physiology", done: true },
    { d: "Day 2", t: "Renal & acid–base", done: true },
    { d: "Day 3", t: "Weak spot: Endocrine", done: false, focus: true },
    { d: "Day 4", t: "Mixed practice exam", done: false },
  ];
  const frame = useCurrentFrame();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }}>
      {items.map((it, i) => {
        const d = delay + 8 + i * 9;
        const op = interpolate(frame, [d, d + 8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: OUT,
        });
        const x = interpolate(frame, [d, d + 10], [40, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: OUT,
        });
        return (
          <div key={i} style={{ display: "flex", gap: 22, opacity: op, transform: `translateX(${x}px)` }}>
            {/* timeline rail */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  background: it.done ? colors.green : it.focus ? colors.champagne : colors.panelSoft,
                  border: it.done || it.focus ? "none" : `2px solid ${colors.champagneDim}`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 18,
                  color: colors.bg,
                }}
              >
                {it.done ? "✓" : ""}
              </div>
              {i < items.length - 1 && (
                <div style={{ width: 3, flex: 1, minHeight: 70, background: colors.borderSoft }} />
              )}
            </div>
            {/* card */}
            <div
              style={{
                flex: 1,
                marginBottom: 18,
                padding: "20px 26px",
                borderRadius: 22,
                background: it.focus ? "rgba(217,200,163,0.1)" : colors.panelSoft,
                border: `1.5px solid ${it.focus ? colors.champagne : colors.borderSoft}`,
              }}
            >
              <div style={{ fontFamily: fonts.mono, fontSize: 22, color: colors.champagneDim }}>
                {it.d}
              </div>
              <div
                style={{
                  fontFamily: fonts.sans,
                  fontWeight: 600,
                  fontSize: 32,
                  color: it.done ? colors.muted : colors.cream,
                }}
              >
                {it.t}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// small helper
const FadeUp: React.FC<{ children: React.ReactNode; delay: number }> = ({ children, delay }) => {
  const frame = useCurrentFrame();
  const op = interpolate(frame, [delay, delay + 8], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  const y = interpolate(frame, [delay, delay + 10], [22, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: OUT,
  });
  return <div style={{ opacity: op, transform: `translateY(${y}px)` }}>{children}</div>;
};
