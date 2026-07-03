import React from "react";
import { AbsoluteFill } from "remotion";
import { colors } from "../theme";

// Near-black with a subtle warm vignette/gradient.
export const Background: React.FC<{ glow?: number }> = ({ glow = 0 }) => {
  return (
    <AbsoluteFill style={{ background: colors.bg }}>
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(120% 80% at 50% 18%, rgba(201,188,163,0.10) 0%, rgba(201,188,163,0.03) 35%, rgba(10,10,10,0) 70%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(140% 100% at 50% 50%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)",
        }}
      />
      {glow > 0 ? (
        <AbsoluteFill
          style={{
            background:
              "radial-gradient(60% 40% at 50% 50%, rgba(201,188,163,0.22) 0%, rgba(201,188,163,0) 70%)",
            opacity: glow,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
