import React from "react";
import { colors, fonts } from "../theme";

// Glassmorphism card — frosted panel with soft border + inner glow. Positioned
// by the caller (absolute) or laid out inline.
export const GlassCard: React.FC<{
  children?: React.ReactNode;
  style?: React.CSSProperties;
  radius?: number;
  tint?: string;
  glow?: boolean;
}> = ({ children, style, radius = 34, tint = "rgba(30,30,28,0.55)", glow = false }) => (
  <div
    style={{
      background: tint,
      border: `1px solid ${colors.border}`,
      borderRadius: radius,
      backdropFilter: "blur(18px)",
      WebkitBackdropFilter: "blur(18px)",
      boxShadow: glow
        ? `0 30px 80px rgba(0,0,0,0.5), 0 0 60px ${colors.glow}, inset 0 1px 0 rgba(255,255,255,0.08)`
        : "0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.08)",
      ...style,
    }}
  >
    {children}
  </div>
);

// Small rounded label / tag.
export const Pill: React.FC<{
  children: React.ReactNode;
  color?: string;
  bg?: string;
  style?: React.CSSProperties;
}> = ({ children, color = colors.beige, bg = "rgba(232,220,200,0.12)", style }) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      padding: "12px 24px",
      borderRadius: 999,
      background: bg,
      border: `1px solid ${colors.border}`,
      color,
      fontFamily: fonts.sans,
      fontWeight: 600,
      fontSize: 30,
      letterSpacing: 0.3,
      ...style,
    }}
  >
    {children}
  </div>
);

// Source citation chip like `p. 214 · Biochemistry.pdf`.
export const SourceChip: React.FC<{ page: string; file: string; style?: React.CSSProperties }> = ({
  page,
  file,
  style,
}) => (
  <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 12,
      padding: "12px 20px",
      borderRadius: 14,
      background: "rgba(127,231,214,0.10)",
      border: `1px solid rgba(127,231,214,0.35)`,
      fontFamily: fonts.mono,
      fontSize: 26,
      color: colors.electric,
      ...style,
    }}
  >
    <span style={{ width: 9, height: 9, borderRadius: "50%", background: colors.electric, boxShadow: `0 0 12px ${colors.glowElectric}` }} />
    {page} · {file}
  </div>
);
