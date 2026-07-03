import React, { useEffect, useState } from "react";
import { Img, delayRender, continueRender } from "remotion";

// Uses the real screenshot from /public when it exists, otherwise renders the
// on-brand CSS fallback. Decision is made before the frame is captured via
// delayRender/continueRender, so renders never flash a broken image.
export const SmartShot: React.FC<{
  src: string;
  fallback: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ src, fallback, style }) => {
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");
  const [handle] = useState(() => delayRender(`resolve ${src}`));

  useEffect(() => {
    const img = new window.Image();
    img.onload = () => {
      setStatus("ok");
      continueRender(handle);
    };
    img.onerror = () => {
      setStatus("error");
      continueRender(handle);
    };
    img.src = src;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, handle]);

  if (status === "ok") {
    return <Img src={src} style={{ width: "100%", display: "block", ...style }} />;
  }
  if (status === "error") {
    return <>{fallback}</>;
  }
  return null;
};
