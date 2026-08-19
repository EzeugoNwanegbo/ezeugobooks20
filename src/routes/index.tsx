import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { startGuestSession } from "@/lib/guest-session";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import { signInWithGoogleNative } from "@/lib/native-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - a search engine for your textbooks" },
      {
        name: "description",
        content:
          "Google, but for textbooks. Upload thousand-page PDFs, slides and notes, then ask questions and get answers quoted straight from your own material.",
      },
    ],
  }),
  component: Landing,
});

// One screen: headline + auth on the left, a meme slideshow on the right.
// Discipline (medicine / law) is picked later in onboarding, so the landing
// page carries a single neutral dark theme instead of per-track variants.

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap";

/* The tail of the headline, cycled forever. */
const PHRASES = [
  "big files",
  "thousand-page textbooks",
  "PDFs",
  "PowerPoint slides",
  "Word documents",
];
const LONGEST_PHRASE = "thousand-page textbooks";
const PHRASE_MS = 2200;

/* Slideshow. Purely decorative ambience - the panel is hidden from assistive
   tech (see MemeSlideshow), so these carry no alt copy of their own. */
const MEMES: string[] = [
  "/memes/meme-01.jpg",
  "/memes/spongebob.jpg",
  "/memes/meme-02.jpg",
  "/memes/jake.jpg",
  "/memes/meme-03.jpg",
  "/memes/delulu.jpg",
  "/memes/meme-04.jpg",
  "/memes/in-the-beginning.jpg",
  "/memes/meme-05.jpg",
  "/memes/ann14a.jpg",
  "/memes/funny-viral-meme.jpg",
  "/memes/textbook-study-memes.jpg",
];
const SLIDE_MS = 3500;

/** True when the visitor asked the OS to reduce motion. SSR-safe. */
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ----------------------------------------------------------------- */
/* Try for free - starts a no-signup guest session.                    */
/* ----------------------------------------------------------------- */
function TryForFreeButton({
  className = "",
  label = "Try for free",
}: {
  className?: string;
  label?: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    if (user) {
      navigate({ to: "/app/chat" });
      return;
    }
    try {
      setBusy(true);
      await startGuestSession();
      navigate({ to: "/app/chat" });
    } catch (err) {
      // Say why before moving them. This used to swallow the error and drop the
      // student on the signup page with no explanation, which reads as the
      // button having misfired rather than as a deliberate hand-off.
      // startGuestSession() already phrases the disabled-provider case for a
      // student ("Guest mode isn't available right now..."), so it is safe to
      // show verbatim.
      toast.error(err instanceof Error ? err.message : "Could not start a guest session.");
      navigate({ to: "/auth", search: { mode: "signup" } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`gd-btn gd-btn-ghost ${className}`}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
    >
      {busy && <span className="gd-spinner" aria-hidden="true" />}
      {busy ? "Starting…" : label}
    </button>
  );
}

/* ----------------------------------------------------------------- */
/* Headline - static lead-in, infinitely rotating tail.                */
/* ----------------------------------------------------------------- */
function RotatingHeadline() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % PHRASES.length);
    }, PHRASE_MS);
    return () => clearInterval(id);
  }, [reduced]);

  return (
    <h1 className="gd-h1">
      {/* One stable sentence for screen readers and SEO. */}
      <span className="gd-sr-only">A search engine for thousand-page textbooks.</span>
      <span aria-hidden="true">
        <span className="gd-h1-lead">A search engine for</span>
        <span className="gd-rotator" aria-live="off">
          {/* Invisible longest phrase reserves the box so nothing reflows. */}
          <span className="gd-rotator-sizer">{LONGEST_PHRASE}</span>
          <span key={reduced ? "static" : index} className="gd-rotator-word">
            {PHRASES[reduced ? 0 : index]}
          </span>
        </span>
      </span>
    </h1>
  );
}

/* ----------------------------------------------------------------- */
/* Auth card - the same Google flow /auth uses; email hands off there. */
/* ----------------------------------------------------------------- */
function AuthCard() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      if (isNativeApp()) {
        // Google blocks OAuth inside embedded webviews, so the native build
        // hands off to the system browser and finishes via the deep link.
        await signInWithGoogleNative();
        return; // spinner holds; we've left the app
      }
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;

      // The success path used to just `return`, leaving googleBusy true on the
      // assumption that the browser was already on its way to Google. When that
      // navigation does not happen - a blocked redirect, an extension, a slow
      // or dropped connection - the button stayed disabled behind a spinner
      // with no error and no way back. The page looked frozen, and a reload was
      // the only escape.
      //
      // Nothing here can observe "the navigation failed", so this asks the only
      // question that can be answered: are we still on this page a few seconds
      // later? If so the redirect did not happen, and the student gets their
      // button back. If it did, this timer dies with the page.
      window.setTimeout(() => {
        setGoogleBusy(false);
        toast.error("Google sign-in did not open. Check your connection and try again.");
      }, 6000);
      return;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleBusy(false);
    }
  };

  // /auth's search schema only accepts `mode`, so the address is collected
  // again there rather than smuggled through a param it would reject.
  const handleEmail = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ to: "/auth", search: { mode: "signup" } });
  };

  return (
    <div className="gd-auth">
      <button
        type="button"
        className="gd-btn gd-btn-google"
        onClick={handleGoogle}
        disabled={googleBusy}
        aria-busy={googleBusy}
      >
        {googleBusy ? (
          <span className="gd-spinner gd-spinner-dark" aria-hidden="true" />
        ) : (
          <GoogleMark />
        )}
        {googleBusy ? "Opening Google…" : "Continue with Google"}
      </button>

      <div className="gd-or">
        <span className="gd-or-rule" />
        OR
        <span className="gd-or-rule" />
      </div>

      <form className="gd-email-form" onSubmit={handleEmail}>
        <label className="gd-sr-only" htmlFor="gd-email">
          Email address
        </label>
        <input
          id="gd-email"
          className="gd-input"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your personal or work email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <button type="submit" className="gd-btn gd-btn-primary gd-btn-block">
          Continue with email
        </button>
      </form>

      <p className="gd-fineprint">
        By continuing you agree to our{" "}
        <Link to="/privacy" className="gd-fineprint-link">
          Privacy Policy
        </Link>
        .
      </p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="gd-google-mark" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/* ----------------------------------------------------------------- */
/* Meme slideshow - crossfading panel on the right.                    */
/*                                                                     */
/* Decorative only: it advances by itself and offers nothing to click, */
/* so the whole panel is hidden from assistive tech and the images     */
/* carry empty alts. Nothing here announces how many memes there are.  */
/* It stops for prefers-reduced-motion, which is the one real gate.    */
/* ----------------------------------------------------------------- */
function MemeSlideshow() {
  const reduced = useReducedMotion();
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % MEMES.length);
    }, SLIDE_MS);
    return () => clearInterval(id);
  }, [reduced]);

  const active = reduced ? 0 : index;

  return (
    <div className="gd-slideshow" aria-hidden="true">
      <div className="gd-slides">
        {MEMES.map((src, i) => (
          <img
            key={src}
            className={`gd-slide ${i === active ? "is-on" : ""}`}
            src={src}
            alt=""
            loading={i === 0 ? "eager" : "lazy"}
            decoding="async"
            draggable={false}
          />
        ))}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Landing                                                             */
/* ----------------------------------------------------------------- */
function Landing() {
  return (
    <div className="gd-root">
      <link rel="stylesheet" href={FONTS_HREF} />
      <link rel="preload" as="image" href={MEMES[0]} />
      <style>{GD_CSS}</style>

      <div className="gd-blob gd-blob-1" aria-hidden="true" />
      <div className="gd-blob gd-blob-2" aria-hidden="true" />

      <header className="gd-nav">
        <Link to="/" className="gd-logo">
          G&amp;D
        </Link>
        <TryForFreeButton className="gd-nav-cta" label="Try for free" />
      </header>

      <main className="gd-hero">
        <section className="gd-hero-copy">
          <RotatingHeadline />
          <p className="gd-sub">Google, but for textbooks.</p>
          <AuthCard />
        </section>

        {/* Ambience. Labelling it would announce an empty region, since the
            panel inside is aria-hidden. */}
        <section className="gd-hero-visual">
          <MemeSlideshow />
        </section>
      </main>

      <footer className="gd-footer">
        <span className="gd-footer-meta">© {new Date().getFullYear()} G&amp;D</span>
        <Link to="/privacy" className="gd-footer-meta gd-footer-link">
          Privacy
        </Link>
      </footer>
    </div>
  );
}

const GD_CSS = `
/* This block is self-contained on purpose — the landing does not load the app's
   token system — so the five colours are restated here. They must stay in step
   with :root in styles.css or / and the signed-in app stop looking like the
   same product:
     Black #070707 · Graphite #2D2D2D · Bone #E9E0D1 · Pale Oak #D5C9AE
     · Faded Copper #A58763 (the accent). */
.gd-root {
  --bg: #070707;
  --surface: #131211;
  --surface-2: #1E1D1B;
  --on: #E9E0D1;
  --on-dim: #A79C88;
  --outline: rgba(233,224,209,0.16);
  --outline-2: rgba(233,224,209,0.09);
  --accent: #A58763;
  /* Lifted copper, for the one place the accent is small text on a plate. */
  --accent-lift: #C2A17A;
  --accent-soft: rgba(165,135,99,0.15);
  --font-display: "Schibsted Grotesk", system-ui, sans-serif;
  --font-body: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-x: clip;
  color: var(--on);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
  background:
    radial-gradient(circle at 14% 10%, var(--accent-soft), transparent 30rem),
    radial-gradient(circle at 88% 16%, rgba(213,201,174,0.07), transparent 32rem),
    var(--bg);
}

.gd-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0;
}

/* Ambient */
.gd-blob { position: fixed; z-index: -1; border-radius: 9999px; filter: blur(120px); opacity: 0.4; pointer-events: none; }
.gd-blob-1 {
  top: -10%; right: -5%; width: 45vw; height: 45vw; max-width: 620px; max-height: 620px;
  background: radial-gradient(circle, var(--accent-soft), transparent 70%);
  animation: gd-float-1 22s ease-in-out infinite;
}
.gd-blob-2 {
  bottom: -15%; left: -10%; width: 50vw; height: 50vw; max-width: 700px; max-height: 700px;
  /* Was a cool blue counterweight to the teal; now Pale Oak, so the two blobs
     read as one warm light source rather than two. */
  background: radial-gradient(circle, rgba(213,201,174,0.09), transparent 70%);
  animation: gd-float-2 26s ease-in-out infinite;
}
@keyframes gd-float-1 { 50% { transform: translate(-4%, 6%) scale(1.08); } }
@keyframes gd-float-2 { 50% { transform: translate(6%, -4%) scale(1.1); } }

/* Nav */
.gd-nav {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1.1rem clamp(1.25rem, 5vw, 4rem);
}
.gd-logo {
  font-family: var(--font-display); font-weight: 700; font-size: 1.5rem;
  letter-spacing: -0.02em; color: var(--on); text-decoration: none;
}

/* Buttons */
.gd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.6rem;
  border-radius: 9999px; padding: 0.85rem 1.5rem; border: 1px solid transparent;
  font-family: var(--font-body); font-weight: 600; font-size: 0.98rem;
  text-decoration: none; cursor: pointer; white-space: nowrap; min-height: 46px;
  transition: transform 0.2s ease, background 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.3s ease;
}
.gd-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.gd-btn:disabled { cursor: progress; opacity: 0.75; transform: none; }
.gd-btn-block { width: 100%; }
/* The sign-in button is the accent, same as --primary in the app. Near-black
   ink on Faded Copper is 6.0:1. */
.gd-btn-primary { background: var(--accent); color: #0E0B08; box-shadow: 0 16px 42px rgba(165,135,99,0.16); }
.gd-btn-primary:hover:not(:disabled) { transform: translateY(-1px); background: var(--accent-lift); }
.gd-btn-ghost { background: transparent; color: var(--on); border-color: var(--outline); padding: 0.6rem 1.2rem; min-height: 42px; }
.gd-btn-ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.gd-btn-google { width: 100%; background: #ffffff; color: #1b1d1f; }
.gd-btn-google:hover:not(:disabled) { transform: translateY(-1px); background: #f3f4f6; }
.gd-google-mark { width: 18px; height: 18px; flex: none; }
.gd-spinner {
  width: 17px; height: 17px; border-radius: 9999px; flex: none;
  border: 2px solid rgba(233,224,209,0.25); border-top-color: var(--on);
  animation: gd-spin 0.7s linear infinite;
}
/* Sits inside the primary/Google buttons, whose ink is dark. */
.gd-spinner-dark { border-color: rgba(14,11,8,0.25); border-top-color: #0E0B08; }
@keyframes gd-spin { to { transform: rotate(360deg); } }

/* Hero */
.gd-hero {
  flex: 1; width: 100%; max-width: 1180px; margin: 0 auto;
  display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center;
  gap: clamp(2.5rem, 6vw, 5rem);
  padding: clamp(1.5rem, 4vw, 3.5rem) clamp(1.25rem, 5vw, 4rem) clamp(3rem, 6vw, 5rem);
}
.gd-hero-copy { min-width: 0; max-width: 30rem; }

/* Headline */
.gd-h1 {
  margin: 0;
  font-family: var(--font-display); font-weight: 600;
  font-size: clamp(2.2rem, 4.9vw, 3.7rem); line-height: 1.08; letter-spacing: -0.035em;
}
.gd-h1-lead { display: block; color: var(--on); }
.gd-rotator { position: relative; display: block; }
.gd-rotator-sizer { visibility: hidden; display: block; }
.gd-rotator-word {
  position: absolute; inset: 0; display: block;
  /* Bone into copper — was white into teal. Both ends clear AA on the ground
     (Bone 18:1, copper 6.5:1) so the rotating word never drops out. */
  background: linear-gradient(135deg, var(--on) 4%, var(--accent-lift) 78%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
@media (prefers-reduced-motion: no-preference) {
  .gd-rotator-word { animation: gd-phrase 0.45s cubic-bezier(0.22, 1, 0.36, 1) both; }
}
@keyframes gd-phrase {
  from { opacity: 0; transform: translateY(0.42em); }
  to { opacity: 1; transform: none; }
}

.gd-sub {
  margin: 1.1rem 0 0; font-size: clamp(1.05rem, 1.5vw, 1.25rem);
  line-height: 1.5; color: var(--on-dim);
}

/* Auth card */
.gd-auth {
  margin-top: 2.25rem; display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--outline-2);
  border-radius: 1.5rem; padding: 1.35rem;
  box-shadow: 0 40px 120px rgba(0,0,0,0.55);
}
.gd-or {
  display: flex; align-items: center; gap: 0.85rem; margin: 1.1rem 0;
  font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.16em; color: var(--on-dim);
}
.gd-or-rule { flex: 1; height: 1px; background: var(--outline-2); }
.gd-email-form { display: flex; flex-direction: column; gap: 0.7rem; }
.gd-input {
  width: 100%; min-height: 46px; border-radius: 9999px;
  background: var(--surface-2); border: 1px solid var(--outline);
  padding: 0.8rem 1.25rem; color: var(--on);
  font-family: var(--font-body); font-size: 0.95rem;
}
.gd-input::placeholder { color: var(--on-dim); }
.gd-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.gd-fineprint { margin: 1.1rem 0 0; text-align: center; font-size: 0.75rem; line-height: 1.5; color: var(--on-dim); }
.gd-fineprint-link { color: var(--on-dim); text-decoration: underline; text-underline-offset: 3px; }
.gd-fineprint-link:hover { color: var(--accent); }

/* Slideshow */
.gd-hero-visual { min-width: 0; display: flex; justify-content: center; }
.gd-slideshow { width: 100%; max-width: 460px; min-width: 0; }
.gd-slides {
  position: relative; width: 100%; aspect-ratio: 4 / 5; overflow: hidden;
  border-radius: 1.75rem; background: var(--surface-2);
  border: 1px solid var(--outline-2);
  box-shadow: 0 50px 130px rgba(0,0,0,0.6);
}
.gd-slide {
  position: absolute; inset: 0; width: 100%; height: 100%;
  object-fit: cover; opacity: 0; transition: opacity 0.7s ease; user-select: none;
}
.gd-slide.is-on { opacity: 1; }

/* Footer */
.gd-footer {
  display: flex; align-items: center; gap: 1.25rem;
  padding: 1.25rem clamp(1.25rem, 5vw, 4rem) 2rem;
}
.gd-footer-meta { font-family: var(--font-mono); font-size: 0.68rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-dim); }
.gd-footer-link { text-decoration: none; }
.gd-footer-link:hover { color: var(--accent); }

/* Responsive - single column, panel under the card */
@media (max-width: 900px) {
  .gd-hero { grid-template-columns: 1fr; padding-top: 1rem; }
  .gd-hero-copy { max-width: 32rem; margin: 0 auto; width: 100%; }
  .gd-hero-visual { order: 2; }
  .gd-slideshow { max-width: 32rem; }
  .gd-slides { aspect-ratio: 1 / 1; }
}
@media (max-width: 420px) {
  .gd-auth { padding: 1.1rem; border-radius: 1.25rem; }
}

@media (prefers-reduced-motion: reduce) {
  .gd-blob { animation: none; }
  .gd-slide { transition: none; }
  .gd-btn:hover { transform: none; }
}
`;
