import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { VERBS, Verb, ripple } from "../motion";
import { fonts, colors } from "../theme";

// Kinetic headline. Splits into words (or chars for `by="char"`) and applies one
// of the motion verbs with a per-unit stagger, so words slam / punch / slide /
// explode / stretch / fold / morph / ripple onto the screen.
export const KineticText: React.FC<{
  text: string;
  verb: Verb;
  delay?: number;
  stagger?: number; // frames between units
  by?: "word" | "char";
  size?: number;
  weight?: number;
  color?: string;
  font?: string;
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  glow?: boolean;
  style?: React.CSSProperties;
}> = ({
  text,
  verb,
  delay = 0,
  stagger = 3,
  by = "word",
  size = 120,
  weight = 800,
  color = colors.white,
  font = fonts.display,
  italic = false,
  letterSpacing = -2,
  lineHeight = 0.98,
  glow = false,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fn = VERBS[verb];

  const units = by === "char" ? Array.from(text) : text.split(" ");

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        justifyContent: "center",
        alignItems: "center",
        gap: by === "char" ? 0 : "0.28em",
        fontFamily: font,
        fontWeight: weight,
        fontStyle: italic ? "italic" : "normal",
        fontSize: size,
        lineHeight,
        letterSpacing,
        color,
        textAlign: "center",
        textShadow: glow ? `0 0 40px ${colors.glow}, 0 0 12px ${colors.glow}` : undefined,
        ...style,
      }}
    >
      {units.map((u, i) => {
        const s = fn(frame, fps, delay + i * stagger);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: s.opacity,
              transform: s.transform,
              filter: s.filter,
              whiteSpace: u === " " ? "pre" : undefined,
            }}
          >
            {u === " " ? " " : u}
          </span>
        );
      })}
    </div>
  );
};

// Per-letter ripple wave — letters rise in sequence like a wave passing through.
export const RippleText: React.FC<{
  text: string;
  delay?: number;
  stagger?: number;
  size?: number;
  weight?: number;
  color?: string;
  font?: string;
  letterSpacing?: number;
  glow?: boolean;
}> = ({
  text,
  delay = 0,
  stagger = 2,
  size = 120,
  weight = 800,
  color = colors.beige,
  font = fonts.display,
  letterSpacing = -1,
  glow = true,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        fontFamily: font,
        fontWeight: weight,
        fontSize: size,
        letterSpacing,
        color,
        textShadow: glow ? `0 0 36px ${colors.glow}` : undefined,
      }}
    >
      {Array.from(text).map((c, i) => {
        const s = ripple(frame, fps, delay + i * stagger);
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              opacity: s.opacity,
              transform: s.transform,
              whiteSpace: c === " " ? "pre" : undefined,
            }}
          >
            {c === " " ? " " : c}
          </span>
        );
      })}
    </div>
  );
};
