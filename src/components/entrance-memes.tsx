import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";

const MEMES = [
  "spongebob",
  "meme-01",
  "meme-02",
  "jake",
  "meme-03",
  "delulu",
  "meme-04",
  "in-the-beginning",
  "meme-05",
  "ann14a",
  "funny-viral-meme",
  "textbook-study-memes",
];

export function EntranceMemes() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (paused || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((current) => (current + 1) % MEMES.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [paused, reducedMotion]);
  const move = (direction: number) => {
    setPaused(true);
    setIndex((current) => (current + direction + MEMES.length) % MEMES.length);
  };
  return (
    <div className="gd-home-memes" aria-label="Study break picture gallery">
      <div className="gd-home-preview-label">A LITTLE LAUGH BEFORE THE LEARNING</div>
      <div className="gd-home-meme-photo">
        <img
          src={`/memes/${MEMES[index]}.jpg`}
          alt={
            index === 0
              ? "SpongeBob heading out with a backpack and headphones"
              : `Study break meme ${index + 1}`
          }
          width={736}
          height={644}
          decoding="async"
        />
        <span className="gd-home-meme-sticker">
          Been there.
          <br />
          Studied that.
        </span>
      </div>
      <div className="gd-home-meme-controls">
        <span>
          STUDY MOOD{" "}
          <span aria-live={paused ? "polite" : "off"}>
            {String(index + 1).padStart(2, "0")} / 12
          </span>
        </span>
        <div>
          <button type="button" aria-label="Previous picture" onClick={() => move(-1)}>
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            aria-label={
              paused || reducedMotion ? "Play picture slideshow" : "Pause picture slideshow"
            }
            disabled={reducedMotion}
            onClick={() => setPaused((value) => !value)}
          >
            {paused || reducedMotion ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button type="button" aria-label="Next picture" onClick={() => move(1)}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
