import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { colors } from "../theme";

// Build a smooth closed path through points using a Catmull-Rom → cubic Bézier.
function smoothClosedPath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n < 3) return "";
  let d = `M ${pts[0].x.toFixed(2)} ${pts[0].y.toFixed(2)} `;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)} `;
  }
  return d + "Z";
}

// Distance from centre to the edge of an axis-aligned rectangle along `theta`.
const rectRadius = (theta: number, hw: number, hh: number) => {
  const c = Math.abs(Math.cos(theta));
  const s = Math.abs(Math.sin(theta));
  return Math.min(c < 1e-4 ? Infinity : hw / c, s < 1e-4 ? Infinity : hh / s);
};

// Liquid "Venom" symbiote blob. Organic wobble by default; set `squareness`
// toward 1 to morph the silhouette into a rounded-rectangle UI element.
export const Blob: React.FC<{
  cx: number;
  cy: number;
  radius: number;
  color?: string;
  points?: number;
  wobble?: number;
  speed?: number;
  squareness?: number; // 0 = blob, 1 = rectangle
  rectW?: number;
  rectH?: number;
  opacity?: number;
  glow?: number; // blur radius of the glow layer
  seed?: number;
}> = ({
  cx,
  cy,
  radius,
  color = colors.beige,
  points = 14,
  wobble = 0.22,
  speed = 0.05,
  squareness = 0,
  rectW,
  rectH,
  opacity = 1,
  glow = 40,
  seed = 0,
}) => {
  const frame = useCurrentFrame();
  const hw = (rectW ?? radius * 2) / 2;
  const hh = (rectH ?? radius * 2) / 2;

  const pts = Array.from({ length: points }, (_, i) => {
    const theta = (i / points) * Math.PI * 2;
    const n =
      Math.sin(theta * 3 + frame * speed + seed) * 0.55 +
      Math.sin(theta * 5 - frame * speed * 0.7 + seed * 2) * 0.3 +
      Math.sin(theta * 2 + frame * speed * 1.3) * 0.15;
    const rBlob = radius * (1 + wobble * n);
    const rRect = Math.min(rectRadius(theta, hw, hh), radius * 2.4);
    const r = rBlob * (1 - squareness) + rRect * squareness;
    return { x: cx + Math.cos(theta) * r, y: cy + Math.sin(theta) * r };
  });

  const d = smoothClosedPath(pts);

  return (
    <AbsoluteFill style={{ opacity }}>
      <svg width="100%" height="100%" style={{ position: "absolute", overflow: "visible" }}>
        <defs>
          <radialGradient id={`blobfill-${seed}`} cx="42%" cy="38%" r="72%">
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="70%" stopColor={color} stopOpacity={0.92} />
            <stop offset="100%" stopColor={color} stopOpacity={0.72} />
          </radialGradient>
        </defs>
        {glow > 0 && <path d={d} fill={color} opacity={0.35} style={{ filter: `blur(${glow}px)` }} />}
        <path d={d} fill={`url(#blobfill-${seed})`} />
        {/* Wet specular highlight. */}
        <ellipse
          cx={cx - radius * 0.28}
          cy={cy - radius * 0.34}
          rx={radius * 0.34}
          ry={radius * 0.2}
          fill="rgba(255,255,255,0.28)"
          style={{ filter: "blur(10px)" }}
        />
      </svg>
    </AbsoluteFill>
  );
};
