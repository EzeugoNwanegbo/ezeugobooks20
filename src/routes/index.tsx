import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startGuestSession } from "@/lib/guest-session";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - understand your files, practice smarter, pass" },
      {
        name: "description",
        content:
          "Upload your textbook, lecture notes, PDFs, or slides. Get explanations, citations, general context when you need it, and practice questions from what you are studying.",
      },
    ],
  }),
  component: Landing,
});

// Landing for "/" - Symbiote Organicism aesthetic (deep black + warm beige,
// pill shapes, Sora / Hanken Grotesk / JetBrains Mono), self-contained styles
// + Google Fonts (React 19 hoists <link>/<style> into <head>). Motion is pure
// CSS keyframes + one IntersectionObserver for scroll reveals - no new deps.

/* ----------------------------------------------------------------- */
/* Try for free - starts a no-signup guest session, falls back to     */
/* /auth signup when anonymous sign-ins are unavailable.              */
/* ----------------------------------------------------------------- */
function TryForFreeButton({
  className = "",
  label = "Try for free",
  icon = "bolt",
}: {
  className?: string;
  label?: string;
  icon?: string;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);

  const onClick = async () => {
    if (busy) return;
    if (user) {
      // Already signed in (or already a guest) - straight to the workspace.
      // Bare /app has no child route and renders an empty shell, so always
      // land on the chat screen.
      navigate({ to: "/app/chat" });
      return;
    }
    try {
      setBusy(true);
      await startGuestSession();
      navigate({ to: "/app/chat" }); // shell routes new users to onboarding
    } catch {
      // anonymous sign-ins disabled or network error → fall back to signup
      navigate({ to: "/auth", search: { mode: "signup" } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`gd-btn gd-btn-primary ${className}`}
      onClick={onClick}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? (
        <span className="gd-spinner" aria-hidden="true" />
      ) : (
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>
      )}
      {busy ? "Starting…" : label}
    </button>
  );
}

/* ----------------------------------------------------------------- */
/* Count-up number - animates when scrolled into view; respects       */
/* prefers-reduced-motion by rendering the final value immediately.   */
/* ----------------------------------------------------------------- */
function CountUp({ to, duration = 1400 }: { to: number; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const formatted = to.toLocaleString("en-US");
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || typeof IntersectionObserver === "undefined") {
      el.textContent = formatted;
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = Math.round(to * eased).toLocaleString("en-US");
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.6 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return <span ref={ref}>0</span>;
}

/* ----------------------------------------------------------------- */
/* Landing                                                            */
/* ----------------------------------------------------------------- */
function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);

  // One observer for every scroll-reveal element. Elements are only hidden
  // under (prefers-reduced-motion: no-preference), so this is purely additive.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>(".gd-r"));
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("gd-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("gd-in");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.16, rootMargin: "0px 0px -6% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  const scrollToHow = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const el = document.getElementById("how-it-works");
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <div className="gd-root" ref={rootRef}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
      />
      <style>{GD_CSS}</style>

      {/* ambient organic glow */}
      <div className="gd-blob gd-blob-1" aria-hidden="true" />
      <div className="gd-blob gd-blob-2" aria-hidden="true" />

      {/* Nav */}
      <header className="gd-nav">
        <Link to="/" className="gd-logo">G&amp;D</Link>
        <nav className="gd-nav-links" aria-label="Product">
          <Link to="/app/chat" className="gd-nav-link">Chat</Link>
          <Link to="/app/library" className="gd-nav-link">Library</Link>
          <Link to="/app/last-minute" className="gd-nav-link">Last Minute</Link>
          <Link to="/app/studybody" className="gd-nav-link">Coach</Link>
        </nav>
        <TryForFreeButton className="gd-nav-cta" icon="bolt" />
      </header>

      <main>
        {/* ------------------------------------------------------- */}
        {/* Hero                                                      */}
        {/* ------------------------------------------------------- */}
        <section className="gd-hero">
          <div className="gd-hero-copy">
            <span className="gd-eyebrow gd-rise gd-rise-1">Understand · verify · practice · pass</span>
            <h1 className="gd-h1 gd-rise gd-rise-2">
              Don&apos;t you want to understand every concept in your textbook?
            </h1>
            <p className="gd-lead gd-rise gd-rise-3">
              Not just read the pages. Actually know what your textbook, PDF, slide, or lecture
              file is trying to teach you.
            </p>
            <div className="gd-actions gd-rise gd-rise-4">
              <a
                href="#how-it-works"
                onClick={scrollToHow}
                className="gd-btn gd-btn-primary gd-btn-lg"
              >
                Yes, show me
                <span className="material-symbols-outlined" aria-hidden="true">
                  arrow_downward
                </span>
              </a>
              <a
                href="#how-it-works"
                onClick={scrollToHow}
                className="gd-btn gd-btn-ghost gd-btn-lg"
              >
                I want to pass
                <span className="material-symbols-outlined" aria-hidden="true">
                  school
                </span>
              </a>
            </div>
            <div className="gd-trust gd-rise gd-rise-5">
              <span className="material-symbols-outlined" aria-hidden="true">verified</span>
              Your files first · general knowledge when you choose it
            </div>
          </div>

          {/* Showstopper: textbook dropping in, racing to "Done in 12s" */}
          <div
            className="gd-hero-visual"
            role="img"
            aria-label="Animated demo: a 48 megabyte, 512-page textbook PDF is dropped in, a progress bar races to the end, and the upload finishes in 12 seconds - every page ready to search."
          >
            <div className="gd-mock">
              <div className="gd-mock-head">
                <span className="gd-mock-dot" />
                <span className="gd-mock-dot" />
                <span className="gd-mock-dot" />
                <span className="gd-mock-title">g&amp;d · upload</span>
              </div>
              <div className="gd-mock-file">
                <span className="gd-mock-file-icon material-symbols-outlined">
                  picture_as_pdf
                </span>
                <span className="gd-mock-file-meta">
                  <strong>biology_textbook.pdf</strong>
                  <em>48 MB · 512 pages</em>
                </span>
              </div>
              <div className="gd-mock-track">
                <span className="gd-mock-fill" />
              </div>
              <div className="gd-mock-status">
                <span className="gd-mock-s gd-mock-s1">Uploading - 48 MB…</span>
                <span className="gd-mock-s gd-mock-s2">Indexing 512 pages…</span>
                <span className="gd-mock-s gd-mock-done">
                  <span className="material-symbols-outlined">check_circle</span>
                  Done in 12s
                </span>
              </div>
              <div className="gd-mock-ready">
                <span className="material-symbols-outlined">search</span>
                Ask anything - every page is now searchable.
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* 01 · Speed                                                */}
        {/* ------------------------------------------------------- */}
        <section className="gd-section" id="how-it-works">
          <div className="gd-section-head gd-r">
            <span className="gd-eyebrow">01 · Upload</span>
            <h2 className="gd-h2">
              Don&apos;t you want your files to explain themselves?
            </h2>
            <p className="gd-lead">
              Upload a textbook, PDF, lecture note, slide, or image. Ask in plain English and get
              a clean explanation without fighting the document first.
            </p>
          </div>

          <div className="gd-race gd-r" role="img" aria-label="Comparison: reading a textbook yourself takes about six hours; G&D is ready to answer in twelve seconds.">
            <div className="gd-race-row">
              <span className="gd-race-label">Reading it yourself</span>
              <div className="gd-race-track">
                <span className="gd-race-fill gd-race-fill-slow" />
              </div>
              <span className="gd-race-time">~6 hrs</span>
            </div>
            <div className="gd-race-row">
              <span className="gd-race-label gd-race-label-us">G&amp;D</span>
              <div className="gd-race-track">
                <span className="gd-race-fill gd-race-fill-fast" />
              </div>
              <span className="gd-race-time gd-race-time-us">12 s</span>
            </div>
          </div>

          <div className="gd-stats">
            <div className="gd-stat gd-r">
              <span className="gd-stat-n">
                <CountUp to={15} />
                <span className="gd-stat-unit">s</span>
              </span>
              <span className="gd-stat-label">from upload to ready - any size</span>
            </div>
            <div className="gd-stat gd-r" style={{ "--rd": "0.12s" } as React.CSSProperties}>
              <span className="gd-stat-n">
                <CountUp to={1000} />
                <span className="gd-stat-unit">+</span>
              </span>
              <span className="gd-stat-label">pages handled without slowing down</span>
            </div>
            <div className="gd-stat gd-r" style={{ "--rd": "0.24s" } as React.CSSProperties}>
              <span className="gd-stat-n">
                <CountUp to={1} />
              </span>
              <span className="gd-stat-label">question away from the exact answer</span>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* 02 · Grounded answers                                     */}
        {/* ------------------------------------------------------- */}
        <section className="gd-section">
          <div className="gd-split">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">02 · Ask</span>
              <h2 className="gd-h2">
                Don&apos;t you want answers that show where they came from?
              </h2>
              <p className="gd-lead">
                Use your files only when you need strict citations. Switch to files plus general
                knowledge when you want a broader explanation. The source mode stays visible.
              </p>
              <ul className="gd-points">
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">description</span>
                  Every answer cites the exact page in your file
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">verified</span>
                  Grounded in your upload - nothing invented
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">search_off</span>
                  Not in your book? It tells you, instead of guessing
                </li>
              </ul>
            </div>

            <div className="gd-split-visual" aria-hidden="true">
              <div className="gd-preview gd-r">
                <div className="gd-preview-q">
                  <span className="material-symbols-outlined">person</span>
                  <p>What actually limits the rate of glycolysis?</p>
                </div>
                <div className="gd-preview-a">
                  <span className="gd-pill-label">Exact answer</span>
                  <p>
                    Phosphofructokinase-1 (PFK-1) catalyzes the committed, rate-limiting step.
                    It's allosterically inhibited by ATP and citrate, so glycolysis slows when
                    energy is already plentiful.
                  </p>
                  <div className="gd-sources">
                    <span className="gd-source-chip">
                      <span className="material-symbols-outlined">description</span>
                      Your upload · p. 87
                    </span>
                    <span className="gd-source-chip">
                      <span className="material-symbols-outlined">verified</span>
                      Quoted, not guessed
                    </span>
                  </div>
                </div>
              </div>
              <div className="gd-preview gd-preview-honest gd-r" style={{ "--rd": "0.18s" } as React.CSSProperties}>
                <div className="gd-preview-q">
                  <span className="material-symbols-outlined">person</span>
                  <p>What does chapter 12 say about CRISPR?</p>
                </div>
                <div className="gd-preview-na">
                  <span className="material-symbols-outlined">search_off</span>
                  <p>
                    Not found in your material - this file has no chapter 12, and nothing was
                    made up to fill the gap.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* 03 · Highlight follow-ups                                 */}
        {/* ------------------------------------------------------- */}
        <section className="gd-section">
          <div className="gd-split gd-split-flip">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">03 · Highlight</span>
              <h2 className="gd-h2">
                Don&apos;t you want difficult lines explained right where you are?
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Highlight any part of an answer and ask a focused follow-up. G&amp;D answers in
                place, beside the exact sentence you were reading, so you never lose your train of
                thought.
              </p>
              <ul className="gd-points">
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">ink_highlighter</span>
                  Turn confusing phrases into focused follow-up questions
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">subdirectory_arrow_right</span>
                  The answer appears inside the original explanation
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">notes</span>
                  Keep the main answer clean while exploring the details
                </li>
              </ul>
            </div>

            <div className="gd-split-visual" aria-hidden="true">
              <div className="gd-preview gd-highlight-demo gd-r">
                <div className="gd-preview-a gd-highlight-answer">
                  <span className="gd-pill-label">Inline follow-up</span>
                  <p>
                    PFK-1 is allosterically inhibited by ATP, meaning high cellular energy slows
                    glycolysis at the committed step.
                  </p>
                  <span className="gd-highlighted-line">allosterically inhibited by ATP</span>
                  <div className="gd-inline-question">
                    <span className="material-symbols-outlined">quickreply</span>
                    <p>Why would ATP switch this enzyme off?</p>
                  </div>
                  <div className="gd-inline-answer">
                    ATP signals that the cell already has enough usable energy, so slowing PFK-1
                    prevents unnecessary glucose breakdown.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* 04 · Last Minute                                          */}
        {/* ------------------------------------------------------- */}
        <section className="gd-section">
          <div className="gd-split">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">04 · Last Minute</span>
              <h2 className="gd-h2">
                Don&apos;t you want scattered files turned into one clean study guide?
              </h2>
              <p className="gd-lead">
                Last Minute reads up to 10 PDFs from the same course, connects related ideas,
                removes repetition, and turns scattered lectures into one topic-organized study
                guide.
              </p>
              <ul className="gd-points">
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">hub</span>
                  Anatomy, physiology, pathology, and lecture notes become one connected guide
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">verified</span>
                  Confidence labels show which sections are strongly supported
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">download</span>
                  Download Markdown, DOCX, or PDF, then continue in My Coach
                </li>
              </ul>
            </div>

            <div className="gd-split-visual" aria-hidden="true">
              <div className="gd-preview gd-r">
                <div className="gd-preview-q">
                  <span className="material-symbols-outlined">auto_awesome</span>
                  <p>Last Minute Master Note</p>
                </div>
                <div className="gd-preview-a">
                  <span className="gd-pill-label">Heart revision</span>
                  <p>
                    SA node automaticity, cardiac cycle pressure changes, ECG waves, and coronary
                    blood supply are grouped by topic instead of separated by lecture file.
                  </p>
                  <div className="gd-sources">
                    <span className="gd-source-chip">
                      <span className="material-symbols-outlined">description</span>
                      5 PDFs connected
                    </span>
                    <span className="gd-source-chip">
                      <span className="material-symbols-outlined">fact_check</span>
                      Confidence: High
                    </span>
                  </div>
                </div>
              </div>
              <div className="gd-preview gd-preview-honest gd-r" style={{ "--rd": "0.18s" } as React.CSSProperties}>
                <div className="gd-preview-na">
                  <span className="material-symbols-outlined">school</span>
                  <p>
                    Open the synthesized note in My Coach to generate MCQs, short answers, rapid
                    revision prompts, and flashcards from the same material.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* 05 · My Coach                                             */}
        {/* ------------------------------------------------------- */}
        <section className="gd-section">
          <div className="gd-split gd-split-flip">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">05 · Master</span>
              <h2 className="gd-h2">
                Don&apos;t you want practice questions that match what you are studying?
              </h2>
              <p className="gd-lead">
                My Coach turns your book into the world's best practice questions - generated
                from your own pages, graded instantly, and tuned from easy to brutal until it
                actually sticks.
              </p>
              <ul className="gd-points">
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">school</span>
                  Questions built from your chapters - not a generic bank
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">task_alt</span>
                  Instant grading, with the page to revisit
                </li>
                <li>
                  <span className="material-symbols-outlined" aria-hidden="true">speed</span>
                  Easy, medium, hard - climb until exam day feels easy
                </li>
              </ul>
            </div>

            <div className="gd-split-visual gd-coach-stack" aria-hidden="true">
              <div className="gd-quiz-card gd-r">
                <span className="gd-quiz-tag">MCQ · from your chapter 2</span>
                <p className="gd-quiz-q">Which step commits glucose to glycolysis?</p>
                <div className="gd-quiz-opt">Hexokinase reaction</div>
                <div className="gd-quiz-opt gd-quiz-opt-right">
                  <span className="material-symbols-outlined">check_circle</span>
                  PFK-1 reaction
                </div>
                <div className="gd-quiz-opt">Pyruvate kinase reaction</div>
              </div>
              <div className="gd-quiz-card gd-r" style={{ "--rd": "0.16s" } as React.CSSProperties}>
                <span className="gd-quiz-tag">Short answer · graded instantly</span>
                <p className="gd-quiz-q">Explain why glycolysis speeds up when ATP runs low.</p>
                <div className="gd-quiz-grade">
                  <span className="material-symbols-outlined">task_alt</span>
                  9/10 - revisit p. 87 for the citrate detail
                </div>
              </div>
              <div className="gd-quiz-diff gd-r" style={{ "--rd": "0.32s" } as React.CSSProperties}>
                <span>Easy</span>
                <span>Medium</span>
                <span className="gd-quiz-diff-on">Hard</span>
              </div>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- */}
        {/* Closing CTA                                               */}
        {/* ------------------------------------------------------- */}
        <section className="gd-cta-banner gd-r">
          <h2 className="gd-h2">Don&apos;t you want to walk into exams ready?</h2>
          <p className="gd-lead">
            Sign up for G&amp;D. Upload your files, understand the concepts, practice smarter,
            and revise with confidence.
          </p>
          <TryForFreeButton className="gd-btn-lg" label="Sign up for G&D" />
          <span className="gd-cta-micro">Understand · verify · practice · pass</span>
        </section>
      </main>

      <footer className="gd-footer">
        <span className="gd-logo gd-logo-sm">G&amp;D</span>
        <span className="gd-footer-meta">Understand · verify · practice · pass</span>
        <span className="gd-footer-meta">© {new Date().getFullYear()} G&amp;D</span>
      </footer>
    </div>
  );
}

const GD_CSS = `
.gd-root {
  --bg: #060606;
  --surface: #111110;
  --surface-2: #0c0c0b;
  --surface-3: #1b1b19;
  --on: #e9e7e3;
  --on-dim: #b6b4ab;
  --outline: #3a3a34;
  --outline-2: #2a2a26;
  --beige: #e4e4cc;
  --beige-dim: #c8c8b0;
  --on-beige: #1b1d0e;
  --teal: #6ee7d8;
  --teal-soft: rgba(110,231,216,0.16);
  --coral: #ff9f7a;
  --coral-soft: rgba(255,159,122,0.16);
  --violet: #bba7ff;
  --violet-soft: rgba(187,167,255,0.17);
  --yellow: #f8d66d;
  --yellow-soft: rgba(248,214,109,0.17);
  --sky: #8ec5ff;
  --sky-soft: rgba(142,197,255,0.16);
  position: relative;
  min-height: 100dvh;
  /* clip (not hidden) keeps the sticky nav working - overflow-x: hidden would
     turn .gd-root into a scroll container and detach position: sticky. */
  overflow-x: hidden;
  overflow-x: clip;
  background:
    radial-gradient(circle at 12% 12%, var(--teal-soft), transparent 28rem),
    radial-gradient(circle at 88% 18%, var(--violet-soft), transparent 30rem),
    radial-gradient(circle at 50% 95%, rgba(248,214,109,0.09), transparent 34rem),
    var(--bg);
  color: var(--on);
  font-family: "Hanken Grotesk", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
}
.gd-root .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal; font-style: normal; line-height: 1;
  letter-spacing: normal; text-transform: none; display: inline-block;
  white-space: nowrap; direction: ltr;
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
}
.gd-blob {
  position: fixed;
  z-index: -1;
  border-radius: 9999px;
  filter: blur(120px);
  opacity: 0.4;
  pointer-events: none;
}
.gd-blob-1 {
  top: -10%; right: -5%;
  width: 45vw; height: 45vw; max-width: 640px; max-height: 640px;
  background: radial-gradient(circle, rgba(187,167,255,0.24), transparent 70%);
  animation: gd-float-1 22s ease-in-out infinite;
}
.gd-blob-2 {
  bottom: -15%; left: -10%;
  width: 50vw; height: 50vw; max-width: 700px; max-height: 700px;
  background: radial-gradient(circle, rgba(110,231,216,0.18), transparent 70%);
  animation: gd-float-2 26s ease-in-out infinite;
}
@keyframes gd-float-1 { 50% { transform: translate(-4%, 6%) scale(1.08); } }
@keyframes gd-float-2 { 50% { transform: translate(6%, -4%) scale(1.1); } }

/* Nav */
.gd-nav {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 1.5rem;
  padding: 1.1rem clamp(1.25rem, 5vw, 4rem);
  background: rgba(6,6,6,0.7);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--outline-2);
}
.gd-logo {
  font-family: "Sora", sans-serif; font-weight: 700; font-size: 1.5rem;
  letter-spacing: -0.02em; color: var(--on); text-decoration: none;
}
.gd-nav-links { display: flex; gap: 0.5rem; margin-left: auto; }
.gd-nav-link {
  padding: 0.5rem 1rem; border-radius: 9999px;
  color: var(--on-dim); text-decoration: none; font-size: 0.95rem;
  transition: color 0.25s ease, background 0.25s ease;
}
.gd-nav-link:hover { color: var(--on); background: var(--surface-3); }
.gd-nav-cta { margin-left: 0.25rem; }

/* Buttons */
.gd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; padding: 0.85rem 1.5rem;
  border: 1px solid transparent;
  font-family: "Hanken Grotesk", sans-serif; font-weight: 600; font-size: 0.98rem;
  text-decoration: none; cursor: pointer; white-space: nowrap;
  min-height: 44px;
  transition: transform 0.2s ease, background 0.25s ease, border-color 0.25s ease,
    color 0.25s ease, box-shadow 0.3s ease;
}
.gd-btn .material-symbols-outlined { font-size: 20px; }
.gd-btn:focus-visible { outline: 2px solid var(--beige); outline-offset: 3px; }
.gd-btn-primary {
  background: var(--beige);
  color: #10120c;
  box-shadow: 0 16px 42px rgba(228,228,204,0.12);
}
.gd-btn-primary:hover {
  transform: translateY(-2px);
  background: #f1f0db;
  box-shadow: 0 18px 48px rgba(228,228,204,0.16);
}
.gd-btn-primary:active { transform: translateY(0); }
.gd-btn-primary:disabled { opacity: 0.75; cursor: progress; transform: none; box-shadow: none; }
.gd-btn-ghost { background: transparent; color: var(--on); border: 1px solid var(--outline); }
.gd-btn-ghost:hover { border-color: var(--beige); color: var(--beige); transform: translateY(-2px); }
.gd-btn-lg { padding: 1rem 1.9rem; font-size: 1.05rem; }
.gd-spinner {
  width: 18px; height: 18px; border-radius: 9999px;
  border: 2px solid rgba(27,29,14,0.25); border-top-color: var(--on-beige);
  animation: gd-spin 0.7s linear infinite;
}
@keyframes gd-spin { to { transform: rotate(360deg); } }

/* Shared type */
.gd-eyebrow {
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--beige-dim);
}
.gd-h1 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(2.5rem, 5.6vw, 4.5rem); line-height: 1.04;
  letter-spacing: -0.035em; margin: 1rem 0 0;
}
.gd-h2 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(1.75rem, 3.5vw, 2.7rem); line-height: 1.1;
  letter-spacing: -0.025em; margin: 0.75rem 0 0;
}
.gd-accent {
  color: var(--teal);
}
.gd-lead {
  font-size: clamp(1rem, 1.3vw, 1.18rem); line-height: 1.65;
  color: var(--on-dim); margin: 1.25rem 0 0; max-width: 46ch;
}

/* Hero */
.gd-hero {
  display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center;
  gap: clamp(2rem, 5vw, 5rem);
  padding: clamp(3.5rem, 8vw, 7rem) clamp(1.25rem, 5vw, 4rem);
  max-width: 1240px; margin: 0 auto;
}
.gd-h1 {
  background: linear-gradient(135deg, var(--on) 5%, #ffffff 35%, var(--teal) 72%, var(--yellow));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.gd-actions { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2.25rem; }
.gd-trust {
  display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1.75rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.06em; color: var(--on-dim); text-transform: uppercase;
}
.gd-trust .material-symbols-outlined { font-size: 18px; color: var(--beige-dim); }

/* Hero upload mock - the showstopper. One shared 8s timeline, looping.
   Base styles are the FINISHED state, so reduced-motion users see a calm,
   completed upload instead of a blank card. */
.gd-hero-visual { display: flex; justify-content: center; }
.gd-mock {
  width: 100%; max-width: 480px;
  background:
    linear-gradient(145deg, rgba(255,255,255,0.055), transparent 42%),
    var(--surface);
  border: 1px solid var(--outline-2);
  border-radius: 2rem; padding: 1.5rem;
  display: flex; flex-direction: column; gap: 1.1rem;
  box-shadow: 0 40px 120px rgba(0,0,0,0.6);
}
.gd-mock-head { display: flex; align-items: center; gap: 0.45rem; }
.gd-mock-dot {
  width: 9px; height: 9px; border-radius: 9999px;
  background: var(--outline);
}
.gd-mock-title {
  margin-left: auto;
  font-family: "JetBrains Mono", monospace; font-size: 0.66rem;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--on-dim);
}
.gd-mock-file {
  display: flex; align-items: center; gap: 0.9rem;
  background: var(--surface-3); border: 1px solid var(--outline-2);
  border-radius: 1.25rem; padding: 1rem 1.2rem;
}
.gd-mock-file-icon {
  font-size: 26px; color: var(--teal);
  width: 48px; height: 48px; flex: none;
  display: flex; align-items: center; justify-content: center;
  background: var(--teal-soft); border-radius: 9999px;
}
.gd-mock-file-meta { display: flex; flex-direction: column; gap: 0.2rem; min-width: 0; }
.gd-mock-file-meta strong {
  font-weight: 600; font-size: 0.98rem;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.gd-mock-file-meta em {
  font-style: normal;
  font-family: "JetBrains Mono", monospace; font-size: 0.68rem;
  letter-spacing: 0.06em; color: var(--on-dim);
}
.gd-mock-track {
  height: 8px; border-radius: 9999px; overflow: hidden;
  background: var(--surface-3); border: 1px solid var(--outline-2);
}
.gd-mock-fill {
  display: block; height: 100%; border-radius: 9999px;
  background: linear-gradient(90deg, var(--teal), var(--yellow), var(--coral));
  transform-origin: left center;
}
.gd-mock-status { display: grid; min-height: 1.6rem; align-items: center; }
.gd-mock-s {
  grid-area: 1 / 1;
  font-family: "JetBrains Mono", monospace; font-size: 0.74rem;
  letter-spacing: 0.08em; color: var(--on-dim);
  display: inline-flex; align-items: center; gap: 0.45rem;
}
.gd-mock-s1, .gd-mock-s2 { opacity: 0; }
.gd-mock-done { color: var(--beige); font-weight: 500; }
.gd-mock-done .material-symbols-outlined {
  font-size: 18px;
  font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
}
.gd-mock-ready {
  display: flex; align-items: center; gap: 0.6rem;
  background: linear-gradient(135deg, var(--teal), var(--yellow)); color: #10120c;
  border-radius: 1.25rem 1.25rem 1.25rem 0.4rem;
  padding: 0.9rem 1.1rem;
  font-size: 0.92rem; font-weight: 500;
}
.gd-mock-ready .material-symbols-outlined { font-size: 19px; }

@media (prefers-reduced-motion: no-preference) {
  .gd-mock-file { animation: gd-mk-file 8s ease-in-out infinite both; }
  .gd-mock-track { animation: gd-mk-show 8s ease-in-out infinite both; }
  .gd-mock-fill { animation: gd-mk-fill 8s cubic-bezier(0.4, 0.05, 0.2, 1) infinite both; }
  .gd-mock-s1 { animation: gd-mk-s1 8s linear infinite both; }
  .gd-mock-s2 { animation: gd-mk-s2 8s linear infinite both; }
  .gd-mock-done { animation: gd-mk-done 8s cubic-bezier(0.34, 1.56, 0.64, 1) infinite both; }
  .gd-mock-ready { animation: gd-mk-ready 8s ease-out infinite both; }
  .gd-hero-visual { animation: gd-drift 9s ease-in-out 1.2s infinite; }
}
@keyframes gd-drift { 50% { transform: translateY(-7px); } }
@keyframes gd-mk-file {
  0% { opacity: 0; transform: translateY(-26px) scale(0.97); }
  7% { opacity: 1; transform: none; }
  93% { opacity: 1; }
  98%, 100% { opacity: 0; transform: translateY(-26px) scale(0.97); }
}
@keyframes gd-mk-show {
  0%, 6% { opacity: 0; }
  10% { opacity: 1; }
  93% { opacity: 1; }
  98%, 100% { opacity: 0; }
}
@keyframes gd-mk-fill {
  0%, 10% { transform: scaleX(0); }
  26% { transform: scaleX(0.55); }
  33% { transform: scaleX(0.62); }
  42% { transform: scaleX(1); }
  100% { transform: scaleX(1); }
}
@keyframes gd-mk-s1 {
  0%, 9% { opacity: 0; }
  12%, 24% { opacity: 1; }
  27%, 100% { opacity: 0; }
}
@keyframes gd-mk-s2 {
  0%, 27% { opacity: 0; }
  30%, 40% { opacity: 1; }
  43%, 100% { opacity: 0; }
}
@keyframes gd-mk-done {
  0%, 44% { opacity: 0; transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1); }
  93% { opacity: 1; transform: scale(1); }
  98%, 100% { opacity: 0; transform: scale(0.9); }
}
@keyframes gd-mk-ready {
  0%, 54% { opacity: 0; transform: translateY(14px); }
  61% { opacity: 1; transform: none; }
  93% { opacity: 1; }
  98%, 100% { opacity: 0; transform: translateY(8px); }
}

/* Hero entrance - staggered rise on first paint */
@media (prefers-reduced-motion: no-preference) {
  .gd-rise { animation: gd-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .gd-rise-1 { animation-delay: 0.05s; }
  .gd-rise-2 { animation-delay: 0.15s; }
  .gd-rise-3 { animation-delay: 0.28s; }
  .gd-rise-4 { animation-delay: 0.4s; }
  .gd-rise-5 { animation-delay: 0.52s; }
}
@keyframes gd-rise {
  from { opacity: 0; transform: translateY(26px); }
  to { opacity: 1; transform: none; }
}

/* Scroll reveals - hidden only when motion is allowed */
@media (prefers-reduced-motion: no-preference) {
  .gd-r {
    opacity: 0; transform: translateY(28px);
    transition: opacity 0.7s ease, transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
    transition-delay: var(--rd, 0s);
  }
  .gd-r.gd-in { opacity: 1; transform: none; }
}

/* Sections */
.gd-section {
  max-width: 1240px; margin: 0 auto;
  padding: clamp(3rem, 6vw, 5.5rem) clamp(1.25rem, 5vw, 4rem);
  scroll-margin-top: 84px;
}
.gd-section:nth-of-type(2) { --story: var(--teal); --story-soft: var(--teal-soft); }
.gd-section:nth-of-type(3) { --story: var(--sky); --story-soft: var(--sky-soft); }
.gd-section:nth-of-type(4) { --story: var(--coral); --story-soft: var(--coral-soft); }
.gd-section:nth-of-type(5) { --story: var(--violet); --story-soft: var(--violet-soft); }
.gd-section:nth-of-type(6) { --story: var(--yellow); --story-soft: var(--yellow-soft); }
.gd-section .gd-eyebrow {
  display: inline-flex;
  align-items: center;
  border-radius: 9999px;
  background: var(--story-soft, rgba(228,228,204,0.08));
  color: var(--story, var(--beige-dim));
  padding: 0.38rem 0.7rem;
}
.gd-section-head { max-width: 52ch; margin-bottom: 2.75rem; }

/* Race - hours vs seconds */
.gd-race {
  display: flex; flex-direction: column; gap: 1.1rem;
  background:
    radial-gradient(circle at 15% 20%, var(--teal-soft), transparent 24rem),
    radial-gradient(circle at 85% 80%, var(--yellow-soft), transparent 24rem),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--teal) 24%, var(--outline-2));
  border-radius: 1.75rem; padding: clamp(1.25rem, 3vw, 2rem);
  margin-bottom: 2.75rem;
}
.gd-race-row {
  display: grid; grid-template-columns: minmax(110px, 160px) 1fr 72px;
  align-items: center; gap: 1rem;
}
.gd-race-label {
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--on-dim);
}
.gd-race-label-us { color: var(--teal); }
.gd-race-track {
  height: 12px; border-radius: 9999px; overflow: hidden;
  background: var(--surface-3); border: 1px solid var(--outline-2);
}
.gd-race-fill {
  display: block; height: 100%; border-radius: 9999px;
  transform-origin: left center; transform: scaleX(1);
}
.gd-race-fill-slow { background: var(--outline); width: 100%; }
.gd-race-fill-fast {
  background: linear-gradient(90deg, var(--teal), var(--yellow));
  width: 7%; min-width: 34px;
}
.gd-race-time {
  font-family: "JetBrains Mono", monospace; font-size: 0.82rem;
  color: var(--on-dim); text-align: right; white-space: nowrap;
}
.gd-race-time-us { color: var(--teal); font-weight: 500; }
@media (prefers-reduced-motion: no-preference) {
  .gd-race .gd-race-fill-slow { transform: scaleX(0); transition: transform 2.4s cubic-bezier(0.3, 0.6, 0.3, 1) 0.2s; }
  .gd-race .gd-race-fill-fast { transform: scaleX(0); transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1) 2.5s; }
  .gd-race .gd-race-time { opacity: 0; transition: opacity 0.5s ease; }
  .gd-race-row:first-child .gd-race-time { transition-delay: 2.5s; }
  .gd-race-row:last-child .gd-race-time { transition-delay: 2.9s; }
  .gd-race.gd-in .gd-race-fill-slow,
  .gd-race.gd-in .gd-race-fill-fast { transform: scaleX(1); }
  .gd-race.gd-in .gd-race-time { opacity: 1; }
}

/* Stats */
.gd-stats {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 1.25rem;
}
.gd-stat {
  border-top: 1px solid color-mix(in srgb, var(--story, var(--teal)) 35%, var(--outline));
  padding-top: 1.25rem;
  display: flex; flex-direction: column; gap: 0.4rem;
}
.gd-stat-n {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(2.4rem, 4.5vw, 3.4rem); line-height: 1;
  letter-spacing: -0.03em; color: var(--teal);
  font-variant-numeric: tabular-nums;
}
.gd-stat-unit { font-size: 0.55em; color: var(--beige-dim); margin-left: 0.1em; }
.gd-stat-label { color: var(--on-dim); font-size: 0.95rem; line-height: 1.5; max-width: 26ch; }

/* Split sections */
.gd-split {
  display: grid; grid-template-columns: 1fr 1fr; align-items: center;
  gap: clamp(2rem, 5vw, 5rem);
}
.gd-split-visual { display: flex; flex-direction: column; gap: 1.1rem; }
.gd-split-flip .gd-split-copy { order: 2; }
.gd-split-flip .gd-split-visual { order: 1; }
.gd-points {
  list-style: none; margin: 1.75rem 0 0; padding: 0;
  display: flex; flex-direction: column; gap: 0.9rem;
}
.gd-points li {
  display: flex; align-items: flex-start; gap: 0.7rem;
  color: var(--on); font-size: 0.98rem; line-height: 1.5; font-weight: 500;
}
.gd-points .material-symbols-outlined {
  font-size: 20px; color: var(--story, var(--beige)); flex: none; margin-top: 0.1rem;
}

/* Chat preview (grounded answers) */
.gd-preview {
  background:
    linear-gradient(145deg, var(--story-soft, rgba(255,255,255,0.035)), transparent 46%),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--story, var(--beige)) 20%, var(--outline-2));
  border-radius: 2rem; padding: 1.5rem;
  display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 40px 120px rgba(0,0,0,0.6);
  transition: transform 0.3s ease, border-color 0.3s ease;
}
.gd-preview:hover { transform: translateY(-4px); border-color: var(--outline); }
.gd-preview-q {
  display: flex; align-items: flex-start; gap: 0.75rem;
  background: var(--surface-3); border-radius: 1.25rem 1.25rem 1.25rem 0.4rem;
  padding: 1rem 1.25rem; color: var(--on);
}
.gd-preview-q .material-symbols-outlined { font-size: 20px; color: var(--on-dim); }
.gd-preview-q p { margin: 0; font-size: 0.98rem; }
.gd-preview-a {
  background: linear-gradient(135deg, var(--story, var(--beige)), var(--yellow));
  color: #10120c;
  border-radius: 1.25rem 1.25rem 0.4rem 1.25rem; padding: 1.25rem 1.4rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.gd-pill-label {
  align-self: flex-start;
  font-family: "JetBrains Mono", monospace; font-size: 0.62rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  background: rgba(27,29,14,0.12); padding: 0.3rem 0.7rem; border-radius: 9999px;
}
.gd-preview-a p { margin: 0; font-size: 0.95rem; line-height: 1.55; font-weight: 500; }
.gd-sources { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem; }
.gd-source-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: rgba(27,29,14,0.08); border-radius: 9999px;
  padding: 0.35rem 0.75rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.66rem; letter-spacing: 0.03em;
}
.gd-source-chip .material-symbols-outlined { font-size: 14px; }
.gd-preview-honest { padding-bottom: 1.4rem; }
.gd-preview-na {
  display: flex; align-items: flex-start; gap: 0.7rem;
  border: 1px dashed var(--outline);
  border-radius: 1.25rem 1.25rem 0.4rem 1.25rem; padding: 1.1rem 1.25rem;
  color: var(--on-dim);
}
.gd-preview-na .material-symbols-outlined { font-size: 20px; color: var(--beige-dim); flex: none; }
.gd-preview-na p { margin: 0; font-size: 0.92rem; line-height: 1.55; }
.gd-highlight-demo { max-width: 520px; }
.gd-highlight-answer { background: var(--surface); color: var(--on); border: 1px solid var(--outline-2); }
.gd-highlighted-line {
  align-self: flex-start;
  border-radius: 0.45rem;
  background: color-mix(in srgb, var(--coral) 24%, transparent);
  color: var(--coral);
  padding: 0.12rem 0.28rem;
  font-size: 0.94rem;
  line-height: 1.5;
}
.gd-inline-question {
  display: flex; align-items: center; gap: 0.55rem;
  max-width: 92%;
  border: 1px solid var(--outline);
  border-radius: 1rem;
  background: var(--surface-3);
  padding: 0.75rem 0.9rem;
  color: var(--on);
}
.gd-inline-question .material-symbols-outlined { font-size: 18px; color: var(--beige); flex: none; }
.gd-inline-question p { margin: 0; font-size: 0.88rem; line-height: 1.45; }
.gd-inline-answer {
  border-left: 2px solid color-mix(in srgb, var(--beige) 54%, transparent);
  padding: 0.2rem 0 0.2rem 0.85rem;
  color: var(--on-dim);
  font-size: 0.88rem;
  line-height: 1.55;
}

/* Coach quiz cards */
.gd-coach-stack { gap: 1rem; }
.gd-quiz-card {
  background: var(--surface); border: 1px solid var(--outline-2);
  border-radius: 1.75rem; padding: 1.4rem 1.5rem;
  display: flex; flex-direction: column; gap: 0.7rem;
  transition: transform 0.3s ease, border-color 0.3s ease;
}
.gd-quiz-card:hover { transform: translateY(-4px); border-color: var(--outline); }
.gd-quiz-tag {
  font-family: "JetBrains Mono", monospace; font-size: 0.64rem;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--violet);
}
.gd-quiz-q {
  margin: 0; font-family: "Sora", sans-serif; font-weight: 500;
  font-size: 1.02rem; line-height: 1.4;
}
.gd-quiz-opt {
  border: 1px solid var(--outline-2); border-radius: 9999px;
  padding: 0.6rem 1.1rem; font-size: 0.9rem; color: var(--on-dim);
  display: flex; align-items: center; gap: 0.5rem;
}
.gd-quiz-opt-right {
  background: linear-gradient(135deg, var(--violet), var(--teal));
  border-color: transparent;
  color: #10120c; font-weight: 600;
}
.gd-quiz-opt-right .material-symbols-outlined {
  font-size: 18px;
  font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
}
.gd-quiz-grade {
  display: inline-flex; align-items: center; gap: 0.5rem;
  align-self: flex-start;
  background: var(--violet-soft); border-radius: 9999px;
  padding: 0.5rem 1rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.04em; color: var(--violet);
}
.gd-quiz-grade .material-symbols-outlined { font-size: 17px; }
.gd-quiz-diff {
  display: flex; gap: 0.5rem; justify-content: center;
}
.gd-quiz-diff span {
  font-family: "JetBrains Mono", monospace; font-size: 0.68rem;
  letter-spacing: 0.1em; text-transform: uppercase;
  border: 1px solid var(--outline-2); border-radius: 9999px;
  padding: 0.45rem 1rem; color: var(--on-dim);
}
.gd-quiz-diff .gd-quiz-diff-on {
  background: linear-gradient(135deg, var(--violet), var(--yellow));
  border-color: transparent;
  color: #10120c; font-weight: 500;
}

/* CTA banner */
.gd-cta-banner {
  max-width: 1240px; margin: 0 auto clamp(2rem, 5vw, 4rem);
  padding: clamp(3rem, 6vw, 5rem) clamp(1.5rem, 5vw, 4rem);
  background:
    radial-gradient(circle at 80% 15%, rgba(187,167,255,0.2), transparent 55%),
    radial-gradient(circle at 15% 90%, rgba(110,231,216,0.18), transparent 55%),
    radial-gradient(circle at 50% 25%, rgba(248,214,109,0.12), transparent 45%),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--teal) 22%, var(--outline-2)); border-radius: 2.5rem;
  text-align: center; display: flex; flex-direction: column; align-items: center;
}
.gd-cta-banner .gd-lead { margin-bottom: 2rem; }
.gd-cta-micro {
  margin-top: 1.25rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.68rem;
  letter-spacing: 0.1em; text-transform: uppercase; color: var(--on-dim);
}

/* Footer */
.gd-footer {
  display: flex; flex-wrap: wrap; align-items: center; gap: 1rem;
  padding: 2rem clamp(1.25rem, 5vw, 4rem);
  border-top: 1px solid var(--outline-2);
}
.gd-logo-sm { font-size: 1.1rem; }
.gd-footer-meta {
  font-family: "JetBrains Mono", monospace; font-size: 0.7rem;
  letter-spacing: 0.06em; color: var(--on-dim); text-transform: uppercase;
}
.gd-footer-meta:last-child { margin-left: auto; }

/* Responsive */
@media (max-width: 880px) {
  .gd-hero { grid-template-columns: 1fr; padding-top: 2.5rem; }
  .gd-hero-visual { order: 2; }
  .gd-nav-links { display: none; }
  .gd-nav .gd-nav-cta { margin-left: auto; }
  .gd-split { grid-template-columns: 1fr; }
  .gd-split-flip .gd-split-copy { order: 1; }
  .gd-split-flip .gd-split-visual { order: 2; }
  .gd-race-row { grid-template-columns: 1fr; gap: 0.45rem; }
  .gd-race-time { text-align: left; }
}
@media (max-width: 480px) {
  .gd-actions .gd-btn { flex: 1; }
  .gd-footer-meta:last-child { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .gd-blob { animation: none; }
  .gd-preview:hover, .gd-quiz-card:hover,
  .gd-btn-primary:hover, .gd-btn-ghost:hover { transform: none; }
}
`;
