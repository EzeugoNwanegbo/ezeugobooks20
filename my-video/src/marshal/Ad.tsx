import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { colors } from "./theme";
import { PaintWipeTimed } from "./components/PaintWipe";
import { Scene1Brand } from "./scenes/Scene1Brand";
import { Scene2Promises } from "./scenes/Scene2Promises";
import { Scene3Numbers } from "./scenes/Scene3Numbers";
import { Scene4Products } from "./scenes/Scene4Products";
import { Scene5Projects } from "./scenes/Scene5Projects";
import { Scene6More } from "./scenes/Scene6More";
import { Scene7CTA } from "./scenes/Scene7CTA";

// Marshal Paints & Chemical Industry — 9:16 vertical · 1080x1920 · 30fps ·
// 1350 frames (45s) · SILENT (no <Audio> anywhere).
//
// Scene timeline (frames @ 30fps):
//   S1 Brand reveal      0–150    (0–5s)
//   S2 Four promises     150–360  (5–12s)
//   S3 Trust in numbers  360–510  (12–17s)
//   S4 Product range     510–900  (17–30s)
//   S5 Landmark projects 900–1170 (30–39s)
//   S6 More than paint   1170–1260(39–42s)
//   S7 Close + CTA       1260–1350(42–45s)

const WIPE = 20; // frames per transition sweep
const CUTS = [150, 360, 510, 900, 1170, 1260];

export const MarshalAd: React.FC = () => {
  return (
    <AbsoluteFill style={{ backgroundColor: colors.charcoal }}>
      {/* Scene 1 — Brand reveal · 0–150 */}
      <Sequence from={0} durationInFrames={150}>
        <Scene1Brand />
      </Sequence>

      {/* Scene 2 — Four promises · 150–360 */}
      <Sequence from={150} durationInFrames={210}>
        <Scene2Promises />
      </Sequence>

      {/* Scene 3 — Trust in numbers · 360–510 */}
      <Sequence from={360} durationInFrames={150}>
        <Scene3Numbers />
      </Sequence>

      {/* Scene 4 — Product range · 510–900 */}
      <Sequence from={510} durationInFrames={390}>
        <Scene4Products />
      </Sequence>

      {/* Scene 5 — Landmark projects · 900–1170 */}
      <Sequence from={900} durationInFrames={270}>
        <Scene5Projects />
      </Sequence>

      {/* Scene 6 — More than paint · 1170–1260 */}
      <Sequence from={1170} durationInFrames={90}>
        <Scene6More />
      </Sequence>

      {/* Scene 7 — Close + CTA · 1260–1350 */}
      <Sequence from={1260} durationInFrames={90}>
        <Scene7CTA />
      </Sequence>

      {/* Signature red paint-stroke wipes centered on each cut. */}
      {CUTS.map((c) => (
        <Sequence key={c} from={c - WIPE / 2} durationInFrames={WIPE}>
          <PaintWipeTimed frames={WIPE} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};
