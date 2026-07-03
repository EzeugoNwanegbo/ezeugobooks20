import "./index.css";
import { Composition } from "remotion";
import { Ad } from "./Ad";
import { MarshalAd } from "./marshal/Ad";
import { VIDEO } from "./marshal/theme";
import { BrightAd } from "./bright/Ad";
import { VIDEO as BRIGHT } from "./bright/theme";
import { TextbookAliveAd } from "./alive/Ad";
import { VIDEO as ALIVE } from "./alive/theme";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Marshal Paints & Chemical Industry — 9:16 · 45s · silent. */}
      <Composition
        id="MarshalAd"
        component={MarshalAd}
        durationInFrames={VIDEO.durationInFrames}
        fps={VIDEO.fps}
        width={VIDEO.width}
        height={VIDEO.height}
      />

      <Composition
        id="GandDAd"
        component={Ad}
        durationInFrames={540}
        fps={30}
        width={1080}
        height={1920}
      />

      {/* G&D — Study AI · BRIGHT, slow-paced ad · 9:16 · 40s · uses real screenshots. */}
      <Composition
        id="GandDBrightAd"
        component={BrightAd}
        durationInFrames={BRIGHT.durationInFrames}
        fps={BRIGHT.fps}
        width={BRIGHT.width}
        height={BRIGHT.height}
      />

      {/* GD1 — "Your Textbook Came Alive" · 9:16 · 42s · 100% generated in code. */}
      <Composition
        id="TextbookAlive"
        component={TextbookAliveAd}
        durationInFrames={ALIVE.durationInFrames}
        fps={ALIVE.fps}
        width={ALIVE.width}
        height={ALIVE.height}
      />
    </>
  );
};
