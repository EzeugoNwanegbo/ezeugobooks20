import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { colors, fonts } from "../theme";

// Rounded photo frame with a slow Ken Burns zoom and a charcoal gradient
// at the base for caption legibility. Falls back to a styled charcoal/red
// card (with the client name in red) if the image is missing.

export const PhotoCard: React.FC<{
  src?: string; // staticFile name, e.g. "project1.jpg"
  caption?: string;
  fallbackLabel?: string;
  radius?: number;
  // local-frame window for the Ken Burns ramp
  durationInFrames?: number;
}> = ({ src, caption, fallbackLabel, radius = 44, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { durationInFrames: seqDur } = useVideoConfig();
  const dur = durationInFrames ?? seqDur;

  const [broken, setBroken] = React.useState(false);
  const scale = interpolate(frame, [0, dur], [1.06, 1.16], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const drift = interpolate(frame, [0, dur], [-14, 14], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const showImg = src && !broken;

  return (
    <AbsoluteFill
      style={{
        borderRadius: radius,
        overflow: "hidden",
        backgroundColor: colors.charcoalDeep,
        boxShadow: "0 40px 90px rgba(0,0,0,0.45)",
        border: `2px solid ${colors.hairline}`,
      }}
    >
      {showImg ? (
        <Img
          src={staticFile(src)}
          onError={() => setBroken(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `scale(${scale}) translateY(${drift}px)`,
          }}
        />
      ) : (
        // Graceful fallback card.
        <AbsoluteFill
          style={{
            background: `linear-gradient(145deg, ${colors.charcoalSoft}, ${colors.charcoalDeep})`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              width: 120,
              height: 8,
              borderRadius: 4,
              backgroundColor: colors.red,
              marginBottom: 28,
            }}
          />
          <div
            style={{
              fontFamily: fonts.sans,
              fontWeight: 800,
              color: colors.white,
              fontSize: 56,
              textAlign: "center",
              padding: "0 60px",
              lineHeight: 1.1,
            }}
          >
            {fallbackLabel ?? caption}
          </div>
        </AbsoluteFill>
      )}

      {/* Caption gradient + text (lower-left). */}
      {caption && (
        <>
          <AbsoluteFill
            style={{
              background:
                "linear-gradient(to top, rgba(20,20,22,0.92) 0%, rgba(20,20,22,0.45) 22%, rgba(20,20,22,0) 42%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 46,
              bottom: 46,
              right: 46,
            }}
          >
            <div
              style={{
                width: 70,
                height: 6,
                borderRadius: 3,
                backgroundColor: colors.red,
                marginBottom: 16,
              }}
            />
            <div
              style={{
                fontFamily: fonts.sans,
                fontWeight: 700,
                color: colors.white,
                fontSize: 52,
                lineHeight: 1.05,
              }}
            >
              {caption}
            </div>
          </div>
        </>
      )}
    </AbsoluteFill>
  );
};
