import "./index.css";
import { Composition } from "remotion";
import { Ad } from "./Ad";
import { MarshalAd } from "./marshal/Ad";
import { VIDEO } from "./marshal/theme";
import { BrightAd } from "./bright/Ad";
import { VIDEO as BRIGHT } from "./bright/theme";
import { TextbookAliveAd } from "./alive/Ad";
import { VIDEO as ALIVE } from "./alive/theme";
import { SymbioteAd } from "./symbiote/Ad";
import { VIDEO as SYMBIOTE } from "./symbiote/theme";
import { FutureTrailer } from "./future/Ad";
import { VIDEO as FUTURE } from "./future/theme";
import { ProductUpdateAd } from "./updates/Ad";
import { VIDEO as PRODUCT_UPDATE } from "./updates/theme";
import { PremiumLaunchAd } from "./launch/Ad";
import { VIDEO as PREMIUM_LAUNCH } from "./launch/theme";

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

      {/* GD — "Symbiote" launch film · 9:16 · 60s · premium kinetic · 100% code. */}
      <Composition
        id="GDSymbiote"
        component={SymbioteAd}
        durationInFrames={SYMBIOTE.durationInFrames}
        fps={SYMBIOTE.fps}
        width={SYMBIOTE.width}
        height={SYMBIOTE.height}
      />

      {/* GD1.ONLINE - "The Future Starts Today" cinematic trailer - 9:16 - 20s. */}
      <Composition
        id="GD1FutureTrailer"
        component={FutureTrailer}
        durationInFrames={FUTURE.durationInFrames}
        fps={FUTURE.fps}
        width={FUTURE.width}
        height={FUTURE.height}
      />

      {/* GD1 product update — 40s vertical motion graphics; no human characters. */}
      <Composition
        id="GD1ProductUpdate"
        component={ProductUpdateAd}
        durationInFrames={PRODUCT_UPDATE.durationInFrames}
        fps={PRODUCT_UPDATE.fps}
        width={PRODUCT_UPDATE.width}
        height={PRODUCT_UPDATE.height}
      />

      {/* G&D product launch — 40s · 4K vertical · 60fps · interface motion only. */}
      <Composition
        id="GandDPremiumLaunch"
        component={PremiumLaunchAd}
        durationInFrames={PREMIUM_LAUNCH.durationInFrames}
        fps={PREMIUM_LAUNCH.fps}
        width={PREMIUM_LAUNCH.width}
        height={PREMIUM_LAUNCH.height}
      />
    </>
  );
};
