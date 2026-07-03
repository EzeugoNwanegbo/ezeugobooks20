import React from "react";
import { colors } from "../theme";

// Minimal red line-icons for the four brand pillars.
// Stroke-based, premium, draw cleanly at any size.

type IconProps = { size?: number; color?: string; stroke?: number };

const Svg: React.FC<React.PropsWithChildren<IconProps>> = ({
  size = 96,
  color = colors.red,
  stroke = 5,
  children,
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 64 64"
    fill="none"
    stroke={color}
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {children}
  </svg>
);

// Durability — shield
export const ShieldIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M32 6 L54 14 V30 C54 44 44 54 32 58 C20 54 10 44 10 30 V14 Z" />
    <path d="M24 31 L30 38 L42 24" />
  </Svg>
);

// Quality — paint roller
export const RollerIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <rect x="10" y="12" width="34" height="16" rx="4" />
    <path d="M44 20 H52 V30 H34" />
    <path d="M34 30 V38 H30" />
    <path d="M30 38 V58" />
  </Svg>
);

// Safety — leaf
export const LeafIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M52 12 C30 12 14 26 14 46 C14 50 16 54 16 54 C16 54 40 54 50 36 C56 26 52 12 52 12 Z" />
    <path d="M20 52 C28 40 38 30 48 22" />
  </Svg>
);

// Trust — handshake
export const HandshakeIcon: React.FC<IconProps> = (p) => (
  <Svg {...p}>
    <path d="M6 24 L16 22 L28 30 L24 36 L18 32" />
    <path d="M58 24 L48 22 L34 30" />
    <path d="M16 22 L24 36 L34 44 L40 40" />
    <path d="M48 22 L40 40 L34 36" />
  </Svg>
);
