import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startGuestSession } from "@/lib/guest-session";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - the study AI for medical & law students" },
      {
        name: "description",
        content:
          "Built for medicine and law. Every answer comes from your own textbooks, cases, and notes - not random websites. Spend less time searching and more time understanding.",
      },
    ],
  }),
  component: LandingRoot,
});

// Landing for "/" - first-time visitors pick their course (Medicine or Law),
// which routes them to a landing variant written in their own language. The
// choice is remembered in localStorage so returning visitors skip the chooser.
// Symbiote Organicism aesthetic (deep black + warm beige, Sora / Hanken Grotesk
// / JetBrains Mono). Motion is pure CSS + one IntersectionObserver.

type Track = "medicine" | "law";
const TRACK_KEY = "gd-track";

/* ----------------------------------------------------------------- */
/* Content - one config per discipline drives an identical layout so   */
/* medicine and law stay perfectly in sync.                            */
/* ----------------------------------------------------------------- */
type Answer = { q: string; a: string; sources: string[] };
type Honest = { q: string; na: string };
type Quiz = {
  tag: string;
  q: string;
  options?: { t: string; right?: boolean }[];
  grade?: string;
};
type Content = {
  track: Track;
  icon: string;
  chooserBlurb: string;
  quote: { text: string; author: string };
  heroKicker: string;
  heroH1: string;
  heroSub: string;
  uploadFile: string;
  feels: { title: string; lines: string[] };
  trust: { title: string; lines: string[]; answer: Answer; honest: Honest };
  time: { title: string; lines: string[] };
  understanding: { title: string; lines: string[]; quiz: Quiz };
  become: { title: string; lines: string[]; cta: string };
};

const MEDICINE: Content = {
  track: "medicine",
  icon: "stethoscope",
  chooserBlurb: "Clinical reasoning, high-yield exam prep, viva & OSCE practice.",
  quote: {
    text: "You have power over your mind - not outside events. Realize this, and you will find strength.",
    author: "Marcus Aurelius",
  },
  heroKicker: "For medical students",
  heroH1: "Understand medicine. Don't just survive it.",
  heroSub:
    "Every answer comes from your own textbooks - not random websites. Spend less time searching, and more time becoming the doctor your patients deserve.",
  uploadFile: "clinical_medicine.pdf",
  feels: {
    title: "We know what medical school feels like",
    lines: [
      "The endless textbooks.",
      "The chapters that refuse to make sense.",
      "The answer you know you've seen - but can't find.",
      "Hours disappear searching when they should be spent understanding.",
      "You deserve better.",
    ],
  },
  trust: {
    title: "Trust isn't optional",
    lines: [
      "Medicine isn't built on guesses.",
      "Every answer comes from your textbooks, not random websites or unreliable AI.",
      "Study from the same trusted sources your exams are built on.",
    ],
    answer: {
      q: "What actually limits the rate of glycolysis?",
      a: "Phosphofructokinase-1 (PFK-1) catalyses the committed, rate-limiting step. It's allosterically inhibited by ATP and citrate, so glycolysis slows when energy is already plentiful.",
      sources: ["Your textbook · p. 87", "Quoted, not guessed"],
    },
    honest: {
      q: "What does chapter 12 say about CRISPR?",
      na: "Not found in your material - this file has no chapter 12, and nothing was invented to fill the gap.",
    },
  },
  time: {
    title: "No one tells you how much time medicine steals",
    lines: [
      "It steals your evenings.",
      "Your weekends.",
      "Your sleep.",
      "Not because medicine is impossible -",
      "but because finding what you need takes longer than understanding it.",
      "We can't make medicine easier.",
      "We can give you back the hours that searching takes away.",
    ],
  },
  understanding: {
    title: "Understanding changes everything",
    lines: [
      "Reading isn't enough.",
      "Ask questions.",
      "Get clear explanations.",
      "Challenge yourself with textbook-based MCQs, viva questions, essays, and clinical reasoning.",
      "Because understanding - not memorization - is what stays with you.",
    ],
    quiz: {
      tag: "MCQ · from your chapter 2",
      q: "Which step commits glucose to glycolysis?",
      options: [
        { t: "Hexokinase reaction" },
        { t: "PFK-1 reaction", right: true },
        { t: "Pyruvate kinase reaction" },
      ],
    },
  },
  become: {
    title: "Become the doctor your patients deserve",
    lines: [
      "One day, there won't be a textbook beside you.",
      "Only your understanding.",
      "Spend less time searching.",
      "Spend more time becoming the doctor you're meant to be.",
    ],
    cta: "Start Learning Free",
  },
};

const LAW: Content = {
  track: "law",
  icon: "balance",
  chooserBlurb: "IRAC, case briefs, statutes & problem-question practice.",
  quote: {
    text: "The life of the law has not been logic; it has been experience.",
    author: "Oliver Wendell Holmes Jr.",
  },
  heroKicker: "For law students",
  heroH1: "Understand the law. Don't just memorize it.",
  heroSub:
    "Every answer comes from your own cases and statutes - not random websites. Spend less time searching, and more time becoming the lawyer your clients deserve.",
  uploadFile: "contract_law_cases.pdf",
  feels: {
    title: "We know what law school feels like",
    lines: [
      "The endless casebooks.",
      "The judgments that bury the ratio ten pages deep.",
      "The authority you know you've read - but can't place.",
      "Hours disappear searching when they should be spent arguing.",
      "You deserve better.",
    ],
  },
  trust: {
    title: "Trust isn't optional",
    lines: [
      "The law isn't built on guesses.",
      "Every answer comes from your cases and statutes, not random websites or unreliable AI.",
      "Cite the same authorities your exams - and your courtroom - will demand.",
    ],
    answer: {
      q: "Is past consideration valid consideration?",
      a: "No - as a rule, consideration must not be past (Re McArdle [1951]). A promise given in return for something already done is unenforceable, unless the act was done at the promisor's request (Lampleigh v Braithwait).",
      sources: ["Your notes · Contract Law p. 34", "Authority cited, not invented"],
    },
    honest: {
      q: "Does chapter 12 cover judicial review?",
      na: "Not found in your material - this file has no chapter 12, and nothing was invented to fill the gap.",
    },
  },
  time: {
    title: "No one tells you how much time law steals",
    lines: [
      "It steals your evenings.",
      "Your weekends.",
      "Your sleep.",
      "Not because law is impossible -",
      "but because finding the authority takes longer than understanding it.",
      "We can't make the law simpler.",
      "We can give you back the hours that searching takes away.",
    ],
  },
  understanding: {
    title: "Understanding changes everything",
    lines: [
      "Reading isn't enough.",
      "Ask questions.",
      "Get clear explanations.",
      "Challenge yourself with problem questions, essays, case briefs, and IRAC reasoning.",
      "Because understanding - not memorization - is what wins arguments.",
    ],
    quiz: {
      tag: "Problem question · graded instantly",
      q: "Advise whether a binding contract was formed on these facts.",
      grade: "8/10 - apply Carlill v Carbolic Smoke Ball on unilateral offers",
    },
  },
  become: {
    title: "Become the lawyer your clients deserve",
    lines: [
      "One day, there won't be a casebook beside you.",
      "Only your judgment.",
      "Spend less time searching.",
      "Spend more time becoming the lawyer you're meant to be.",
    ],
    cta: "Start Learning Free",
  },
};

const CONTENT: Record<Track, Content> = { medicine: MEDICINE, law: LAW };

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
      navigate({ to: "/app/chat" });
      return;
    }
    try {
      setBusy(true);
      await startGuestSession();
      navigate({ to: "/app/chat" });
    } catch {
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
/* Landing root - chooser first, then the chosen variant.             */
/* ----------------------------------------------------------------- */
function LandingRoot() {
  const [track, setTrack] = useState<Track | null>(null);
  const [ready, setReady] = useState(false);

  // Restore a remembered choice on first paint so returning visitors land
  // straight on their variant instead of the chooser.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TRACK_KEY);
      if (saved === "medicine" || saved === "law") setTrack(saved);
    } catch {
      /* localStorage unavailable - just show the chooser */
    }
    setReady(true);
  }, []);

  const choose = (t: Track) => {
    try {
      localStorage.setItem(TRACK_KEY, t);
    } catch {
      /* ignore */
    }
    setTrack(t);
    if (typeof window !== "undefined") window.scrollTo(0, 0);
  };

  if (!ready) return <div className="gd-root" />;
  if (!track) return <Chooser onChoose={choose} />;
  return <LandingVariant content={CONTENT[track]} onSwitch={choose} />;
}

/* ----------------------------------------------------------------- */
/* Chooser - the two clean options a first-time visitor sees.         */
/* ----------------------------------------------------------------- */
function Chooser({ onChoose }: { onChoose: (t: Track) => void }) {
  return (
    <div className="gd-root gd-chooser">
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
      />
      <style>{GD_CSS}</style>
      <div className="gd-blob gd-blob-1" aria-hidden="true" />
      <div className="gd-blob gd-blob-2" aria-hidden="true" />

      <div className="gd-chooser-inner">
        <span className="gd-logo gd-chooser-logo">G&amp;D</span>
        <h1 className="gd-chooser-h1">What are you studying?</h1>
        <p className="gd-chooser-sub">
          G&amp;D speaks your language. Pick your course and we&apos;ll tailor everything -
          the examples, the reasoning, the practice - to you.
        </p>

        <div className="gd-chooser-grid">
          {(["medicine", "law"] as Track[]).map((t) => {
            const c = CONTENT[t];
            return (
              <button
                key={t}
                type="button"
                className="gd-choice"
                onClick={() => onChoose(t)}
              >
                <span className="gd-choice-icon material-symbols-outlined" aria-hidden="true">
                  {c.icon}
                </span>
                <span className="gd-choice-title">
                  {t === "medicine" ? "Medicine" : "Law"}
                </span>
                <span className="gd-choice-blurb">{c.chooserBlurb}</span>
                <span className="gd-choice-go">
                  Enter
                  <span className="material-symbols-outlined" aria-hidden="true">
                    arrow_forward
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <p className="gd-chooser-foot">You can switch anytime.</p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Narrative block - the poetic short-line copy.                      */
/* ----------------------------------------------------------------- */
function Narrative({ lines }: { lines: string[] }) {
  return (
    <div className="gd-narrative">
      {lines.map((line, i) => (
        <p key={i} className="gd-line">
          {line}
        </p>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Landing variant - identical layout, discipline-specific content.   */
/* ----------------------------------------------------------------- */
function LandingVariant({
  content,
  onSwitch,
}: {
  content: Content;
  onSwitch: (t: Track) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // One observer for every scroll-reveal element.
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
  }, [content.track]);

  const c = content;
  const other: Track = c.track === "medicine" ? "law" : "medicine";

  return (
    <div className={`gd-root gd-variant-${c.track}`} ref={rootRef} key={c.track}>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
      />
      <style>{GD_CSS}</style>

      <div className="gd-blob gd-blob-1" aria-hidden="true" />
      <div className="gd-blob gd-blob-2" aria-hidden="true" />

      {/* Nav */}
      <header className="gd-nav">
        <Link to="/" className="gd-logo">G&amp;D</Link>
        <div className="gd-track-switch" role="group" aria-label="Choose course">
          <button
            type="button"
            className={`gd-track-pill ${c.track === "medicine" ? "is-on" : ""}`}
            onClick={() => onSwitch("medicine")}
            aria-pressed={c.track === "medicine"}
          >
            Medicine
          </button>
          <button
            type="button"
            className={`gd-track-pill ${c.track === "law" ? "is-on" : ""}`}
            onClick={() => onSwitch("law")}
            aria-pressed={c.track === "law"}
          >
            Law
          </button>
        </div>
        <TryForFreeButton className="gd-nav-cta" label="Start free" icon="bolt" />
      </header>

      <main>
        {/* Hero */}
        <section className="gd-hero">
          <div className="gd-hero-copy">
            <span className="gd-eyebrow gd-rise gd-rise-1">{c.heroKicker}</span>
            <figure className="gd-quote gd-rise gd-rise-2">
              <blockquote>&ldquo;{c.quote.text}&rdquo;</blockquote>
              <figcaption>- {c.quote.author}</figcaption>
            </figure>
            <h1 className="gd-h1 gd-rise gd-rise-3">{c.heroH1}</h1>
            <p className="gd-lead gd-rise gd-rise-4">{c.heroSub}</p>
            <div className="gd-actions gd-rise gd-rise-5">
              <TryForFreeButton className="gd-btn-lg" label={c.become.cta} icon="bolt" />
            </div>
          </div>

          {/* Hero visual: a real, source-cited answer */}
          <div className="gd-hero-visual gd-rise gd-rise-4" aria-hidden="true">
            <div className="gd-preview">
              <div className="gd-preview-q">
                <span className="material-symbols-outlined">person</span>
                <p>{c.trust.answer.q}</p>
              </div>
              <div className="gd-preview-a">
                <span className="gd-pill-label">Exact answer</span>
                <p>{c.trust.answer.a}</p>
                <div className="gd-sources">
                  {c.trust.answer.sources.map((s, i) => (
                    <span key={i} className="gd-source-chip">
                      <span className="material-symbols-outlined">
                        {i === 0 ? (c.track === "law" ? "gavel" : "description") : "verified"}
                      </span>
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Feels */}
        <section className="gd-section gd-section-narrow">
          <div className="gd-section-head gd-r">
            <span className="gd-eyebrow">The problem</span>
            <h2 className="gd-h2">{c.feels.title}</h2>
          </div>
          <div className="gd-r">
            <Narrative lines={c.feels.lines} />
          </div>
        </section>

        {/* Trust */}
        <section className="gd-section">
          <div className="gd-split">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">Trust</span>
              <h2 className="gd-h2">{c.trust.title}</h2>
              <Narrative lines={c.trust.lines} />
            </div>
            <div className="gd-split-visual" aria-hidden="true">
              <div className="gd-preview gd-r">
                <div className="gd-preview-q">
                  <span className="material-symbols-outlined">person</span>
                  <p>{c.trust.honest.q}</p>
                </div>
                <div className="gd-preview-na">
                  <span className="material-symbols-outlined">search_off</span>
                  <p>{c.trust.honest.na}</p>
                </div>
              </div>
              <div className="gd-upload-note gd-r" style={{ "--rd": "0.14s" } as React.CSSProperties}>
                <span className="material-symbols-outlined">picture_as_pdf</span>
                <span>
                  <strong>{c.uploadFile}</strong> · 48 MB · 512 pages · ready in ~12s
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Time */}
        <section className="gd-section gd-section-narrow gd-time">
          <div className="gd-section-head gd-r">
            <span className="gd-eyebrow">Your time</span>
            <h2 className="gd-h2">{c.time.title}</h2>
          </div>
          <div className="gd-r">
            <Narrative lines={c.time.lines} />
          </div>
        </section>

        {/* Understanding */}
        <section className="gd-section">
          <div className="gd-split gd-split-flip">
            <div className="gd-split-copy gd-r">
              <span className="gd-eyebrow">Master it</span>
              <h2 className="gd-h2">{c.understanding.title}</h2>
              <Narrative lines={c.understanding.lines} />
            </div>
            <div className="gd-split-visual" aria-hidden="true">
              <div className="gd-quiz-card gd-r">
                <span className="gd-quiz-tag">{c.understanding.quiz.tag}</span>
                <p className="gd-quiz-q">{c.understanding.quiz.q}</p>
                {c.understanding.quiz.options?.map((o, i) => (
                  <div
                    key={i}
                    className={`gd-quiz-opt ${o.right ? "gd-quiz-opt-right" : ""}`}
                  >
                    {o.right && (
                      <span className="material-symbols-outlined">check_circle</span>
                    )}
                    {o.t}
                  </div>
                ))}
                {c.understanding.quiz.grade && (
                  <div className="gd-quiz-grade">
                    <span className="material-symbols-outlined">task_alt</span>
                    {c.understanding.quiz.grade}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Become - closing CTA */}
        <section className="gd-cta-banner gd-r">
          <h2 className="gd-h2">{c.become.title}</h2>
          <div className="gd-cta-narrative">
            <Narrative lines={c.become.lines} />
          </div>
          <TryForFreeButton className="gd-btn-lg" label={c.become.cta} icon="bolt" />
          <button type="button" className="gd-switch-link" onClick={() => onSwitch(other)}>
            {other === "law" ? "Studying law instead?" : "Studying medicine instead?"}
          </button>
        </section>
      </main>

      <footer className="gd-footer">
        <span className="gd-logo gd-logo-sm">G&amp;D</span>
        <span className="gd-footer-meta">For medical &amp; law students</span>
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
  --accent: var(--teal);
  --accent-soft: var(--teal-soft);
  position: relative;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-x: clip;
  background:
    radial-gradient(circle at 12% 12%, var(--accent-soft), transparent 28rem),
    radial-gradient(circle at 88% 18%, var(--violet-soft), transparent 30rem),
    radial-gradient(circle at 50% 95%, rgba(248,214,109,0.09), transparent 34rem),
    var(--bg);
  color: var(--on);
  font-family: "Hanken Grotesk", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
}
.gd-variant-law { --accent: var(--sky); --accent-soft: var(--sky-soft); }
.gd-variant-medicine { --accent: var(--teal); --accent-soft: var(--teal-soft); }
.gd-root .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal; font-style: normal; line-height: 1;
  letter-spacing: normal; text-transform: none; display: inline-block;
  white-space: nowrap; direction: ltr;
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
}
.gd-blob {
  position: fixed; z-index: -1; border-radius: 9999px;
  filter: blur(120px); opacity: 0.4; pointer-events: none;
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
  background: radial-gradient(circle, var(--accent-soft), transparent 70%);
  animation: gd-float-2 26s ease-in-out infinite;
}
@keyframes gd-float-1 { 50% { transform: translate(-4%, 6%) scale(1.08); } }
@keyframes gd-float-2 { 50% { transform: translate(6%, -4%) scale(1.1); } }

/* Nav */
.gd-nav {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 1rem;
  padding: 1.1rem clamp(1.25rem, 5vw, 4rem);
  background: rgba(6,6,6,0.7); backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--outline-2);
}
.gd-logo {
  font-family: "Sora", sans-serif; font-weight: 700; font-size: 1.5rem;
  letter-spacing: -0.02em; color: var(--on); text-decoration: none;
}
.gd-track-switch {
  margin-left: auto; display: inline-flex; gap: 0.25rem;
  background: var(--surface-3); border: 1px solid var(--outline-2);
  border-radius: 9999px; padding: 0.25rem;
}
.gd-track-pill {
  border: none; background: transparent; cursor: pointer;
  border-radius: 9999px; padding: 0.4rem 0.95rem;
  font-family: "Hanken Grotesk", sans-serif; font-size: 0.85rem; font-weight: 600;
  color: var(--on-dim); transition: color 0.2s ease, background 0.2s ease;
}
.gd-track-pill:hover { color: var(--on); }
.gd-track-pill.is-on { background: var(--accent); color: #10120c; }
.gd-nav-cta { margin-left: 0.25rem; }

/* Buttons */
.gd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; padding: 0.85rem 1.5rem; border: 1px solid transparent;
  font-family: "Hanken Grotesk", sans-serif; font-weight: 600; font-size: 0.98rem;
  text-decoration: none; cursor: pointer; white-space: nowrap; min-height: 44px;
  transition: transform 0.2s ease, background 0.25s ease, border-color 0.25s ease,
    color 0.25s ease, box-shadow 0.3s ease;
}
.gd-btn .material-symbols-outlined { font-size: 20px; }
.gd-btn:focus-visible { outline: 2px solid var(--beige); outline-offset: 3px; }
.gd-btn-primary { background: var(--beige); color: #10120c; box-shadow: 0 16px 42px rgba(228,228,204,0.12); }
.gd-btn-primary:hover { transform: translateY(-2px); background: #f1f0db; box-shadow: 0 18px 48px rgba(228,228,204,0.16); }
.gd-btn-primary:active { transform: translateY(0); }
.gd-btn-primary:disabled { opacity: 0.75; cursor: progress; transform: none; box-shadow: none; }
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
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--accent);
  display: inline-flex; align-items: center; border-radius: 9999px;
  background: var(--accent-soft); padding: 0.38rem 0.7rem;
}
.gd-h1 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(2.3rem, 4.8vw, 3.9rem); line-height: 1.06;
  letter-spacing: -0.035em; margin: 1.25rem 0 0;
  background: linear-gradient(135deg, var(--on) 5%, #ffffff 35%, var(--accent) 78%, var(--yellow));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.gd-h2 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(1.7rem, 3.4vw, 2.6rem); line-height: 1.12;
  letter-spacing: -0.025em; margin: 0.75rem 0 0;
}
.gd-lead {
  font-size: clamp(1rem, 1.3vw, 1.18rem); line-height: 1.65;
  color: var(--on-dim); margin: 1.25rem 0 0; max-width: 48ch;
}

/* Hero quote */
.gd-quote { margin: 1.75rem 0 0; padding-left: 1.1rem; border-left: 2px solid var(--accent); }
.gd-quote blockquote {
  margin: 0; font-family: "Sora", sans-serif; font-weight: 400; font-style: italic;
  font-size: clamp(1.05rem, 1.6vw, 1.35rem); line-height: 1.5; color: var(--on);
}
.gd-quote figcaption {
  margin-top: 0.55rem; font-family: "JetBrains Mono", monospace;
  font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--beige-dim);
}

/* Hero */
.gd-hero {
  display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center;
  gap: clamp(2rem, 5vw, 5rem);
  padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 5vw, 4rem);
  max-width: 1240px; margin: 0 auto;
}
.gd-actions { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2.25rem; }
.gd-hero-visual { display: flex; justify-content: center; }

/* Sections */
.gd-section {
  max-width: 1240px; margin: 0 auto;
  padding: clamp(2.75rem, 6vw, 5rem) clamp(1.25rem, 5vw, 4rem);
}
.gd-section-narrow { max-width: 820px; text-align: center; }
.gd-section-narrow .gd-eyebrow { margin: 0 auto; }
.gd-section-narrow .gd-narrative { align-items: center; }
.gd-section-head { margin-bottom: 1.75rem; }

/* Narrative lines */
.gd-narrative { display: flex; flex-direction: column; gap: 0.55rem; margin-top: 0.5rem; }
.gd-line {
  margin: 0; font-family: "Sora", sans-serif; font-weight: 400;
  font-size: clamp(1.1rem, 1.7vw, 1.4rem); line-height: 1.45; color: var(--on);
  letter-spacing: -0.01em;
}
.gd-line:last-child { color: var(--accent); font-weight: 500; }
.gd-section-narrow .gd-line { max-width: 40ch; }
.gd-time { position: relative; }

/* Split sections */
.gd-split { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: clamp(2rem, 5vw, 4.5rem); }
.gd-split-visual { display: flex; flex-direction: column; gap: 1rem; }
.gd-split-flip .gd-split-copy { order: 2; }
.gd-split-flip .gd-split-visual { order: 1; }
.gd-split-copy .gd-narrative { margin-top: 1.5rem; }
.gd-split-copy .gd-line { font-size: clamp(1rem, 1.4vw, 1.18rem); }
.gd-split-copy .gd-line:last-child { color: var(--accent); }

/* Chat preview cards */
.gd-preview {
  width: 100%; max-width: 480px;
  background: linear-gradient(145deg, var(--accent-soft), transparent 46%), var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--outline-2));
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
.gd-preview-q .material-symbols-outlined { font-size: 20px; color: var(--on-dim); flex: none; }
.gd-preview-q p { margin: 0; font-size: 0.98rem; }
.gd-preview-a {
  background: linear-gradient(135deg, var(--accent), var(--yellow)); color: #10120c;
  border-radius: 1.25rem 1.25rem 0.4rem 1.25rem; padding: 1.25rem 1.4rem;
  display: flex; flex-direction: column; gap: 0.75rem;
}
.gd-pill-label {
  align-self: flex-start; font-family: "JetBrains Mono", monospace; font-size: 0.62rem;
  letter-spacing: 0.16em; text-transform: uppercase;
  background: rgba(27,29,14,0.12); padding: 0.3rem 0.7rem; border-radius: 9999px;
}
.gd-preview-a p { margin: 0; font-size: 0.95rem; line-height: 1.55; font-weight: 500; }
.gd-sources { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem; }
.gd-source-chip {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: rgba(27,29,14,0.08); border-radius: 9999px; padding: 0.35rem 0.75rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.66rem; letter-spacing: 0.03em;
}
.gd-source-chip .material-symbols-outlined { font-size: 14px; }
.gd-preview-na {
  display: flex; align-items: flex-start; gap: 0.7rem;
  border: 1px dashed var(--outline);
  border-radius: 1.25rem 1.25rem 0.4rem 1.25rem; padding: 1.1rem 1.25rem; color: var(--on-dim);
}
.gd-preview-na .material-symbols-outlined { font-size: 20px; color: var(--beige-dim); flex: none; }
.gd-preview-na p { margin: 0; font-size: 0.92rem; line-height: 1.55; }
.gd-upload-note {
  display: flex; align-items: center; gap: 0.7rem; max-width: 480px;
  background: var(--surface); border: 1px solid var(--outline-2); border-radius: 1.25rem;
  padding: 0.9rem 1.1rem; color: var(--on-dim);
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem; letter-spacing: 0.03em;
}
.gd-upload-note .material-symbols-outlined { font-size: 20px; color: var(--accent); flex: none; }
.gd-upload-note strong { color: var(--on); font-weight: 600; }

/* Quiz card */
.gd-quiz-card {
  width: 100%; max-width: 480px;
  background: var(--surface); border: 1px solid var(--outline-2);
  border-radius: 1.75rem; padding: 1.4rem 1.5rem;
  display: flex; flex-direction: column; gap: 0.7rem;
  transition: transform 0.3s ease, border-color 0.3s ease;
  box-shadow: 0 40px 120px rgba(0,0,0,0.5);
}
.gd-quiz-card:hover { transform: translateY(-4px); border-color: var(--outline); }
.gd-quiz-tag {
  font-family: "JetBrains Mono", monospace; font-size: 0.64rem;
  letter-spacing: 0.14em; text-transform: uppercase; color: var(--violet);
}
.gd-quiz-q { margin: 0; font-family: "Sora", sans-serif; font-weight: 500; font-size: 1.02rem; line-height: 1.4; }
.gd-quiz-opt {
  border: 1px solid var(--outline-2); border-radius: 9999px;
  padding: 0.6rem 1.1rem; font-size: 0.9rem; color: var(--on-dim);
  display: flex; align-items: center; gap: 0.5rem;
}
.gd-quiz-opt-right {
  background: linear-gradient(135deg, var(--violet), var(--accent));
  border-color: transparent; color: #10120c; font-weight: 600;
}
.gd-quiz-opt-right .material-symbols-outlined {
  font-size: 18px; font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24;
}
.gd-quiz-grade {
  display: inline-flex; align-items: center; gap: 0.5rem; align-self: flex-start;
  background: var(--violet-soft); border-radius: 9999px; padding: 0.5rem 1rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem; letter-spacing: 0.04em; color: var(--violet);
}
.gd-quiz-grade .material-symbols-outlined { font-size: 17px; }

/* CTA banner */
.gd-cta-banner {
  max-width: 1240px; margin: clamp(2rem, 5vw, 4rem) auto;
  padding: clamp(3rem, 6vw, 5rem) clamp(1.5rem, 5vw, 4rem);
  background:
    radial-gradient(circle at 80% 15%, rgba(187,167,255,0.2), transparent 55%),
    radial-gradient(circle at 15% 90%, var(--accent-soft), transparent 55%),
    radial-gradient(circle at 50% 25%, rgba(248,214,109,0.12), transparent 45%),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--outline-2)); border-radius: 2.5rem;
  text-align: center; display: flex; flex-direction: column; align-items: center;
}
.gd-cta-narrative { margin: 1.5rem 0 2rem; }
.gd-cta-narrative .gd-narrative { align-items: center; }
.gd-cta-narrative .gd-line { max-width: 42ch; }
.gd-switch-link {
  margin-top: 1.5rem; background: none; border: none; cursor: pointer;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--on-dim); text-decoration: underline;
  text-underline-offset: 4px; transition: color 0.2s ease;
}
.gd-switch-link:hover { color: var(--accent); }

/* Footer */
.gd-footer {
  display: flex; flex-wrap: wrap; align-items: center; gap: 1rem;
  padding: 2rem clamp(1.25rem, 5vw, 4rem); border-top: 1px solid var(--outline-2);
}
.gd-logo-sm { font-size: 1.1rem; }
.gd-footer-meta {
  font-family: "JetBrains Mono", monospace; font-size: 0.7rem;
  letter-spacing: 0.06em; color: var(--on-dim); text-transform: uppercase;
}
.gd-footer-meta:last-child { margin-left: auto; }

/* Chooser */
.gd-chooser { display: flex; align-items: center; justify-content: center; padding: 2rem 1.25rem; }
.gd-chooser-inner {
  position: relative; z-index: 1; width: 100%; max-width: 880px;
  text-align: center; display: flex; flex-direction: column; align-items: center;
}
.gd-chooser-logo { font-size: 2rem; margin-bottom: 1.5rem; }
.gd-chooser-h1 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(2rem, 4.5vw, 3.2rem); line-height: 1.08; letter-spacing: -0.03em; margin: 0;
  background: linear-gradient(135deg, var(--on) 10%, #ffffff 40%, var(--teal) 80%, var(--yellow));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.gd-chooser-sub { margin: 1rem auto 0; max-width: 48ch; color: var(--on-dim); font-size: 1.05rem; line-height: 1.6; }
.gd-chooser-grid {
  margin-top: 2.75rem; width: 100%;
  display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;
}
.gd-choice {
  position: relative; cursor: pointer; text-align: left;
  display: flex; flex-direction: column; gap: 0.75rem;
  padding: 2rem 1.75rem; border-radius: 2rem;
  background: linear-gradient(150deg, rgba(255,255,255,0.05), transparent 46%), var(--surface);
  border: 1px solid var(--outline-2); color: var(--on);
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.3s ease;
}
.gd-choice:hover {
  transform: translateY(-4px); border-color: var(--accent);
  box-shadow: 0 30px 90px rgba(0,0,0,0.5);
}
.gd-choice:nth-child(2):hover { border-color: var(--sky); }
.gd-choice-icon {
  font-size: 40px; color: var(--accent);
  width: 68px; height: 68px; display: flex; align-items: center; justify-content: center;
  background: var(--accent-soft); border-radius: 9999px;
}
.gd-choice:nth-child(2) .gd-choice-icon { color: var(--sky); background: var(--sky-soft); }
.gd-choice-title { font-family: "Sora", sans-serif; font-weight: 600; font-size: 1.6rem; letter-spacing: -0.02em; }
.gd-choice-blurb { color: var(--on-dim); font-size: 0.95rem; line-height: 1.5; }
.gd-choice-go {
  margin-top: 0.5rem; display: inline-flex; align-items: center; gap: 0.4rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem; letter-spacing: 0.1em;
  text-transform: uppercase; color: var(--accent);
}
.gd-choice:nth-child(2) .gd-choice-go { color: var(--sky); }
.gd-choice-go .material-symbols-outlined { font-size: 16px; transition: transform 0.2s ease; }
.gd-choice:hover .gd-choice-go .material-symbols-outlined { transform: translateX(4px); }
.gd-chooser-foot {
  margin-top: 2rem; font-family: "JetBrains Mono", monospace; font-size: 0.7rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--on-dim);
}

/* Hero entrance */
@media (prefers-reduced-motion: no-preference) {
  .gd-rise { animation: gd-rise 0.85s cubic-bezier(0.22, 1, 0.36, 1) both; }
  .gd-rise-1 { animation-delay: 0.05s; }
  .gd-rise-2 { animation-delay: 0.15s; }
  .gd-rise-3 { animation-delay: 0.28s; }
  .gd-rise-4 { animation-delay: 0.4s; }
  .gd-rise-5 { animation-delay: 0.52s; }
}
@keyframes gd-rise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }

/* Scroll reveals */
@media (prefers-reduced-motion: no-preference) {
  .gd-r {
    opacity: 0; transform: translateY(28px);
    transition: opacity 0.7s ease, transform 0.75s cubic-bezier(0.22, 1, 0.36, 1);
    transition-delay: var(--rd, 0s);
  }
  .gd-r.gd-in { opacity: 1; transform: none; }
}

/* Responsive */
@media (max-width: 880px) {
  .gd-hero { grid-template-columns: 1fr; padding-top: 2.5rem; }
  .gd-hero-visual { order: 2; }
  .gd-split { grid-template-columns: 1fr; }
  .gd-split-flip .gd-split-copy { order: 1; }
  .gd-split-flip .gd-split-visual { order: 2; }
  .gd-chooser-grid { grid-template-columns: 1fr; }
  .gd-track-switch { margin-left: 0; }
  .gd-nav { flex-wrap: wrap; }
}
@media (max-width: 480px) {
  .gd-actions .gd-btn { flex: 1; }
  .gd-footer-meta:last-child { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .gd-blob { animation: none; }
  .gd-preview:hover, .gd-quiz-card:hover, .gd-choice:hover,
  .gd-btn-primary:hover { transform: none; }
}
`;
