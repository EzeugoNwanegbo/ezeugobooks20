import React from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { SmartShot } from "../components/SmartShot";
import { interpolate } from "remotion";
import { colors, fonts } from "./theme";
import { slowZoom, calmSpring, SOFT } from "./motion";

// A clean rounded "phone card" that floats on the bright background and presents
// a real screenshot nearly full-frame, with a very slow Ken Burns zoom/pan so it
// feels alive but calm. Falls back to a soft coloured card if the image is
// missing, so the project always renders.
export const PhoneCard: React.FC<{
  src: string;
  // Soft fallback shown when the screenshot file isn't in /public yet.
  fallbackTitle: string;
  fallbackTint?: string;
  // Ken Burns focus point (0–1) the slow zoom drifts toward.
  focusX?: number;
  focusY?: number;
  zoomFrom?: number;
  zoomTo?: number;
  // Frames over which the slow Ken Burns zoom plays (usually the scene length).
  zoomDuration?: number;
  // Optional slow vertical pan, in % of card height (e.g. panFrom={-4} panTo={4}
  // drifts gently downward). Great for panning a long list like the roadmap.
  panFrom?: number;
  panTo?: number;
  // Card geometry (defaults present the shot nearly full-frame, captions below).
  width?: number;
  height?: number;
  top?: number;
  children?: React.ReactNode; // optional highlight overlays, positioned by scenes
}> = ({
  src,
  fallbackTitle,
  fallbackTint = colors.teal,
  focusX = 0.5,
  focusY = 0.5,
  zoomFrom = 1.0,
  zoomTo = 1.08,
  zoomDuration = 210,
  panFrom = 0,
  panTo = 0,
  // Defaults match the cropped screenshot aspect (498×885 ≈ 0.563) so the shot
  // fills the card with no letterboxing and overlay fractions map 1:1 to it.
  width = 820,
  height = 1457,
  top = 120,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const left = (1080 - width) / 2;

  // Calm entrance: ease up + settle, slight rise.
  const enter = calmSpring(frame, fps);
  const cardScale = 0.965 + 0.035 * enter;
  const cardRise = (1 - enter) * 26;

  // Very slow Ken Burns on the inner screenshot, across the scene length.
  const zoom = slowZoom(frame, zoomDuration, zoomFrom, zoomTo);
  const pan = interpolate(frame, [0, zoomDuration], [panFrom, panTo], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: SOFT,
  });

  return (
    <AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left,
          top,
          width,
          height,
          transform: `translateY(${cardRise}px) scale(${cardScale})`,
          borderRadius: 48,
          overflow: "hidden",
          background: colors.card,
          border: `1px solid ${colors.cardBorder}`,
          boxShadow: `0 40px 90px -30px ${colors.cardShadow}, 0 8px 24px -12px rgba(0,0,0,0.18)`,
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            transform: `scale(${zoom}) translateY(${pan}%)`,
            transformOrigin: `${focusX * 100}% ${focusY * 100}%`,
          }}
        >
          <SmartShot
            src={src}
            style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${focusX * 100}% ${focusY * 100}%` }}
            fallback={
              <FallbackCard title={fallbackTitle} tint={fallbackTint} />
            }
          />

          {/* Scene-specific highlight overlays (coral underline, glow, etc.).
              Inside the zoom/pan wrapper so they stay glued to image features
              during the Ken Burns move. */}
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// On-brand soft fallback so the composition renders even before screenshots are
// dropped into /public.
const FallbackCard: React.FC<{ title: string; tint: string }> = ({ title, tint }) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      flexDirection: "column",
      gap: 22,
      background: `linear-gradient(160deg, #FFFFFF 0%, ${tint}22 100%)`,
      padding: 60,
      textAlign: "center",
    }}
  >
    <div
      style={{
        width: 96,
        height: 96,
        borderRadius: 28,
        background: tint,
        opacity: 0.9,
      }}
    />
    <div
      style={{
        fontFamily: fonts.sans,
        fontWeight: 600,
        fontSize: 40,
        color: colors.inkSoft,
        lineHeight: 1.25,
      }}
    >
      {title}
    </div>
    <div
      style={{
        fontFamily: fonts.mono,
        fontSize: 24,
        color: colors.inkSoft,
        opacity: 0.7,
      }}
    >
      add screenshot to /public
    </div>
  </div>
);
