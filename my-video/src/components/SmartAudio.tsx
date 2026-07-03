import React, { useEffect, useState } from "react";
import { Audio, delayRender, continueRender } from "remotion";

// Renders <Audio> only if music.mp3 actually exists in /public, so the project
// previews/renders cleanly before the track is added.
export const SmartAudio: React.FC<{
  src: string;
  trimBefore?: number;
  trimAfter?: number;
  volume?: number | ((frame: number) => number);
}> = ({ src, trimBefore, trimAfter, volume }) => {
  const [present, setPresent] = useState<boolean | null>(null);
  const [handle] = useState(() => delayRender(`probe ${src}`));

  useEffect(() => {
    let cancelled = false;
    fetch(src, { method: "HEAD" })
      .then((res) => {
        if (!cancelled) setPresent(res.ok);
      })
      .catch(() => {
        if (!cancelled) setPresent(false);
      })
      .finally(() => continueRender(handle));
    return () => {
      cancelled = true;
    };
  }, [src, handle]);

  if (!present) return null;
  return (
    <Audio src={src} trimBefore={trimBefore} trimAfter={trimAfter} volume={volume} />
  );
};
