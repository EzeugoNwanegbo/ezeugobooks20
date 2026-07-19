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

// Landing for "/" - first-time visitors pick their course (Medicine or Law).
// The two are deliberately DIFFERENT products: Medicine is a cool, luminous
// "monitor glow" (Schibsted / IBM Plex Mono, teal, ECG motifs); Law is a warm
// "chambers at lamplight" editorial (Fraunces / Courier Prime, antique gold,
// hairline rules & citations). They share one layout + content schema and
// diverge through per-variant CSS tokens plus split hero + motif components.

type Track = "medicine" | "law";
const TRACK_KEY = "gd-track";

/* ----------------------------------------------------------------- */
/* Fonts - each track loads its own display/mono faces so a visitor    */
/* feels the fork before and after choosing.                           */
/* ----------------------------------------------------------------- */
const FONT_HREF: Record<Track, string> = {
  medicine:
    "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap",
  law: "https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Newsreader:ital,opsz,wght@1,6..72,400..500&family=Hanken+Grotesk:wght@400;500;600&family=Courier+Prime:wght@400;700&display=swap",
};
const CHOOSER_FONTS =
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@500;600;700&family=Fraunces:opsz,wght@9..144,500..700&family=Hanken+Grotesk:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Courier+Prime:wght@400&display=swap";
const SYMBOLS_HREF =
  "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,300,0,0&display=swap";

/* ----------------------------------------------------------------- */
/* Content - one config per discipline drives an identical narrative.  */
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
  heroH1Accent?: string;
  heroSub: string;
  heroVitals?: string[];
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
  heroVitals: ["SOURCE p.87", "CONFIDENCE 100%", "0 GUESSES"],
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
    cta: "Try for free",
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
  heroH1Accent: "law",
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
      sources: ["Re McArdle [1951] · Contract Law p. 34", "Authority cited, not invented"],
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
    cta: "Try for free",
  },
};

const CONTENT: Record<Track, Content> = { medicine: MEDICINE, law: LAW };

/* ----------------------------------------------------------------- */
/* Try for free - starts a no-signup guest session.                    */
/* ----------------------------------------------------------------- */
function TryForFreeButton({
  className = "",
  label = "Try for free",
  icon,
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
      {busy && <span className="gd-spinner" aria-hidden="true" />}
      {!busy && icon && (
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
/* Chooser - a split screen; each half already wears its own world.    */
/* ----------------------------------------------------------------- */
function Chooser({ onChoose }: { onChoose: (t: Track) => void }) {
  return (
    <div className="gd-root gd-chooser">
      <link rel="stylesheet" href={CHOOSER_FONTS} />
      <link rel="stylesheet" href={SYMBOLS_HREF} />
      <style>{GD_CSS}</style>
      <div className="gd-blob gd-blob-1" aria-hidden="true" />
      <div className="gd-blob gd-blob-2" aria-hidden="true" />

      <div className="gd-chooser-inner">
        <span className="gd-logo gd-chooser-logo">G&amp;D</span>
        <h1 className="gd-chooser-h1">What are you studying?</h1>
        <p className="gd-chooser-sub">
          G&amp;D is two study companions in one. Pick your course and everything - the
          look, the examples, the reasoning - is tuned to your world.
        </p>

        <div className="gd-chooser-grid">
          {(["medicine", "law"] as Track[]).map((t) => {
            const c = CONTENT[t];
            return (
              <button
                key={t}
                type="button"
                className={`gd-choice gd-variant-${t}`}
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
/* Motifs                                                              */
/* ----------------------------------------------------------------- */
// Medicine: an ECG trace that flatlines then spikes; draws itself on reveal.
function PulseRule() {
  return (
    <svg className="gd-pulse" viewBox="0 0 600 40" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 20 H235 l9 -13 l7 26 l8 -33 l9 20 H600"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Narrative block - the poetic short-line copy. Collapsible so the page reads
// short by default, with a small tap to reveal the full stanza.
function Narrative({
  lines,
  className = "",
  collapsible = false,
  preview = 2,
}: {
  lines: string[];
  className?: string;
  collapsible?: boolean;
  preview?: number;
}) {
  const [open, setOpen] = useState(false);
  const canCollapse = collapsible && lines.length > preview;
  const shown = canCollapse && !open ? lines.slice(0, preview) : lines;
  return (
    <div className={`gd-narrative ${className}`}>
      {shown.map((line, i) => (
        <p key={i} className="gd-line">
          {line}
        </p>
      ))}
      {canCollapse && (
        <button type="button" className="gd-more" onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : "Read more"}
          <span className="material-symbols-outlined" aria-hidden="true">
            {open ? "expand_less" : "expand_more"}
          </span>
        </button>
      )}
    </div>
  );
}

// Section heading - diverges hard between the two worlds.
function SectionHead({
  track,
  index,
  kicker,
  title,
}: {
  track: Track;
  index: string;
  kicker: string;
  title: string;
}) {
  if (track === "law") {
    return (
      <div className="gd-section-head gd-r gd-law-head">
        <div className="gd-law-rule-top">
          <span className="gd-law-kicker">
            § {index} &nbsp;·&nbsp; {kicker}
          </span>
        </div>
        <h2 className="gd-h2">{title}</h2>
        <div className="gd-law-rule-bottom" />
      </div>
    );
  }
  return (
    <div className="gd-section-head gd-r gd-med-head">
      <span className="gd-eyebrow">{kicker}</span>
      <h2 className="gd-h2">{title}</h2>
      <PulseRule />
    </div>
  );
}

// A source-cited answer card, reused across heroes and the trust section.
function AnswerCard({ answer, track }: { answer: Answer; track: Track }) {
  return (
    <div className="gd-preview">
      <div className="gd-preview-q">
        <span className="material-symbols-outlined">person</span>
        <p>{answer.q}</p>
      </div>
      <div className="gd-preview-a">
        <span className="gd-pill-label">Exact answer</span>
        <p>{answer.a}</p>
        <div className="gd-sources">
          {answer.sources.map((s, i) => (
            <span key={i} className="gd-source-chip">
              <span className="material-symbols-outlined">
                {i === 0 ? (track === "law" ? "gavel" : "description") : "verified"}
              </span>
              {s}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/* Heroes - the biggest point of divergence.                          */
/* ----------------------------------------------------------------- */
function HeroMedicine({ c }: { c: Content }) {
  return (
    <section className="gd-hero gd-hero-med">
      <div className="gd-hero-copy">
        <figure className="gd-med-epigraph gd-rise gd-rise-1">
          <blockquote>&ldquo;{c.quote.text}&rdquo;</blockquote>
          <figcaption>- {c.quote.author}</figcaption>
        </figure>
        <span className="gd-eyebrow gd-instrument gd-rise gd-rise-2">
          ▎ {c.heroKicker}
        </span>
        <h1 className="gd-h1 gd-rise gd-rise-3">{c.heroH1}</h1>
        <p className="gd-lead gd-rise gd-rise-4">{c.heroSub}</p>
        <div className="gd-actions gd-rise gd-rise-5">
          <TryForFreeButton className="gd-btn-lg" label={c.become.cta} />
        </div>
      </div>

      <div className="gd-hero-visual gd-rise gd-rise-3" aria-hidden="true">
        <div className="gd-instrument-card">
          <AnswerCard answer={c.trust.answer} track={c.track} />
          {c.heroVitals && (
            <div className="gd-vitals">
              <span className="gd-vitals-dot" />
              {c.heroVitals.map((v, i) => (
                <span key={i} className="gd-vitals-item">
                  {v}
                </span>
              ))}
            </div>
          )}
          <PulseRule />
        </div>
      </div>
    </section>
  );
}

function HeroLaw({ c }: { c: Content }) {
  // Highlight one word of the headline in gold.
  const renderH1 = () => {
    if (!c.heroH1Accent) return c.heroH1;
    const parts = c.heroH1.split(new RegExp(`(${c.heroH1Accent})`, "i"));
    return parts.map((p, i) =>
      p.toLowerCase() === c.heroH1Accent!.toLowerCase() ? (
        <em key={i}>{p}</em>
      ) : (
        <span key={i}>{p}</span>
      ),
    );
  };

  return (
    <section className="gd-hero gd-hero-law">
      <div className="gd-masthead">
        <div className="gd-law-rule-top gd-rise gd-rise-1" />
        <figure className="gd-epigraph gd-rise gd-rise-2">
          <blockquote>&ldquo;{c.quote.text}&rdquo;</blockquote>
          <figcaption>- {c.quote.author}</figcaption>
        </figure>
        <div className="gd-law-rule-bottom gd-rise gd-rise-2" />

        <span className="gd-law-kicker gd-hero-kicker gd-rise gd-rise-3">{c.heroKicker}</span>
        <h1 className="gd-h1 gd-rise gd-rise-3">{renderH1()}</h1>
        <p className="gd-lead gd-rise gd-rise-4">{c.heroSub}</p>
        <div className="gd-actions gd-rise gd-rise-5">
          <TryForFreeButton className="gd-btn-lg" label={c.become.cta} />
        </div>
      </div>

      <div className="gd-brief gd-r" aria-hidden="true">
        <AnswerCard answer={c.trust.answer} track={c.track} />
      </div>
    </section>
  );
}

/* ----------------------------------------------------------------- */
/* Landing variant - shared layout, discipline-specific everything.   */
/* ----------------------------------------------------------------- */
function LandingVariant({
  content,
  onSwitch,
}: {
  content: Content;
  onSwitch: (t: Track) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

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
      <link rel="stylesheet" href={FONT_HREF[c.track]} />
      <link rel="stylesheet" href={SYMBOLS_HREF} />
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
        <TryForFreeButton className="gd-nav-cta" label="Try for free" />
      </header>

      <main>
        {c.track === "medicine" ? <HeroMedicine c={c} /> : <HeroLaw c={c} />}

        {/* Feels */}
        <section className="gd-section gd-section-narrow gd-feels">
          <SectionHead track={c.track} index="01" kicker="The problem" title={c.feels.title} />
          <div className="gd-r">
            <Narrative lines={c.feels.lines} className="gd-narrative-feels" collapsible preview={2} />
          </div>
        </section>

        {/* Trust */}
        <section className="gd-section">
          <div className="gd-split">
            <div className="gd-split-copy gd-r">
              <SectionHead track={c.track} index="02" kicker="Trust" title={c.trust.title} />
              <Narrative lines={c.trust.lines} collapsible preview={1} />
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
          <SectionHead track={c.track} index="03" kicker="Your time" title={c.time.title} />
          <div className="gd-r">
            <Narrative lines={c.time.lines} collapsible preview={2} />
          </div>
        </section>

        {/* Understanding */}
        <section className="gd-section">
          <div className="gd-split gd-split-flip">
            <div className="gd-split-copy gd-r">
              <SectionHead
                track={c.track}
                index="04"
                kicker="Master it"
                title={c.understanding.title}
              />
              <Narrative lines={c.understanding.lines} collapsible preview={1} />
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
          <TryForFreeButton className="gd-btn-lg" label={c.become.cta} />
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
  /* Structural fallbacks - overridden by .gd-variant-* below */
  --bg: #06070A;
  --surface: #0B1014;
  --surface-2: #080C10;
  --surface-3: #121A20;
  --on: #E8EDF0;
  --on-dim: #9FB0BA;
  --outline: #23303A;
  --outline-2: #18232B;
  --accent: #3FDAC8;
  --accent-soft: rgba(63,218,200,0.16);
  --accent-2: #FF7A70;
  --violet: #bba7ff;
  --violet-soft: rgba(187,167,255,0.17);
  --yellow: #f8d66d;
  --font-display: "Sora", system-ui, sans-serif;
  --font-body: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --font-quote: "Hanken Grotesk", sans-serif;
  --radius-card: 1.75rem;
  --radius-chip: 9999px;
  --gd-dur: 0.55s;
  --gd-ease: cubic-bezier(0.22, 1, 0.36, 1);
  --gd-rise: 28px;

  position: relative;
  min-height: 100dvh;
  overflow-x: hidden;
  overflow-x: clip;
  background: var(--bg);
  color: var(--on);
  font-family: var(--font-body);
  -webkit-font-smoothing: antialiased;
  isolation: isolate;
}

/* ── MEDICINE: monitor glow (cool, luminous) ── */
.gd-variant-medicine {
  --bg: #05070A;
  --surface: #0B1014;
  --surface-2: #080C10;
  --surface-3: #121A20;
  --on: #E8EDF0;
  --on-dim: #9FB0BA;
  --outline: #23303A;
  --outline-2: #18232B;
  --accent: #3FDAC8;
  --accent-soft: rgba(63,218,200,0.15);
  --accent-2: #FF7A70;
  --font-display: "Schibsted Grotesk", "Sora", system-ui, sans-serif;
  --font-body: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;
  --font-quote: "Hanken Grotesk", sans-serif;
  --radius-card: 1.75rem;
  --radius-chip: 9999px;
  --gd-dur: 0.34s;
  --gd-ease: cubic-bezier(0.3, 0.9, 0.3, 1);
  --gd-rise: 14px;
  background:
    radial-gradient(circle at 14% 10%, var(--accent-soft), transparent 30rem),
    radial-gradient(circle at 88% 16%, rgba(127,184,255,0.12), transparent 32rem),
    var(--bg);
}

/* ── LAW: chambers at lamplight (warm, editorial) ── */
.gd-variant-law {
  --bg: #0C0906;
  --surface: #151009;
  --surface-2: #100C07;
  --surface-3: #1D1710;
  --on: #EDE6D6;
  --on-dim: #B3A78F;
  --outline: #352C20;
  --outline-2: #271F16;
  --accent: #CBA35C;
  --accent-soft: rgba(203,163,92,0.14);
  --accent-2: #9E3B34;
  --legal-cream: #F1E4BC;
  --font-display: "Fraunces", Georgia, serif;
  --font-body: "Hanken Grotesk", system-ui, sans-serif;
  --font-mono: "Courier Prime", "Courier New", monospace;
  --font-quote: "Newsreader", Georgia, serif;
  --radius-card: 0.375rem;
  --radius-chip: 0.25rem;
  --gd-dur: 0.7s;
  --gd-ease: cubic-bezier(0.16, 1, 0.3, 1);
  --gd-rise: -8px;
  background:
    radial-gradient(circle at 50% -5%, rgba(203,163,92,0.08), transparent 40rem),
    var(--bg);
}

.gd-root .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal; font-style: normal; line-height: 1;
  letter-spacing: normal; text-transform: none; display: inline-block;
  white-space: nowrap; direction: ltr;
  font-variation-settings: "FILL" 0, "wght" 300, "GRAD" 0, "opsz" 24;
}

/* Ambient - medicine keeps soft blobs; law replaces them with grain */
.gd-blob { position: fixed; z-index: -1; border-radius: 9999px; filter: blur(120px); opacity: 0.4; pointer-events: none; }
.gd-blob-1 {
  top: -10%; right: -5%; width: 45vw; height: 45vw; max-width: 620px; max-height: 620px;
  background: radial-gradient(circle, var(--accent-soft), transparent 70%);
  animation: gd-float-1 22s ease-in-out infinite;
}
.gd-blob-2 {
  bottom: -15%; left: -10%; width: 50vw; height: 50vw; max-width: 700px; max-height: 700px;
  background: radial-gradient(circle, rgba(127,184,255,0.12), transparent 70%);
  animation: gd-float-2 26s ease-in-out infinite;
}
.gd-variant-law .gd-blob { display: none; }
.gd-variant-law::after {
  content: ""; position: fixed; inset: 0; z-index: -1; pointer-events: none; opacity: 0.5;
  background-image: radial-gradient(rgba(203,163,92,0.05) 1px, transparent 1px);
  background-size: 4px 4px;
}
@keyframes gd-float-1 { 50% { transform: translate(-4%, 6%) scale(1.08); } }
@keyframes gd-float-2 { 50% { transform: translate(6%, -4%) scale(1.1); } }

/* Nav */
.gd-nav {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: 1rem;
  padding: 1.1rem clamp(1.25rem, 5vw, 4rem);
  background: color-mix(in srgb, var(--bg) 78%, transparent);
  backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--outline-2);
}
.gd-logo { font-family: var(--font-display); font-weight: 700; font-size: 1.5rem; letter-spacing: -0.02em; color: var(--on); text-decoration: none; }
.gd-variant-law .gd-logo { letter-spacing: 0; }
.gd-track-switch {
  margin-left: auto; display: inline-flex; gap: 0.25rem;
  background: var(--surface-3); border: 1px solid var(--outline-2);
  border-radius: 9999px; padding: 0.25rem;
}
.gd-variant-law .gd-track-switch { border-radius: 0.3rem; }
.gd-track-pill {
  border: none; background: transparent; cursor: pointer; border-radius: 9999px;
  padding: 0.4rem 0.95rem; font-family: var(--font-body); font-size: 0.85rem; font-weight: 600;
  color: var(--on-dim); transition: color 0.2s ease, background 0.2s ease;
}
.gd-variant-law .gd-track-pill { border-radius: 0.2rem; }
.gd-track-pill:hover { color: var(--on); }
.gd-track-pill.is-on { background: var(--accent); color: #10120c; }
.gd-nav-cta { margin-left: 0.25rem; }

/* Buttons */
.gd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  border-radius: 9999px; padding: 0.85rem 1.5rem; border: 1px solid transparent;
  font-family: var(--font-body); font-weight: 600; font-size: 0.98rem;
  text-decoration: none; cursor: pointer; white-space: nowrap; min-height: 44px;
  transition: transform 0.2s ease, background 0.25s ease, border-color 0.25s ease, color 0.25s ease, box-shadow 0.3s ease;
}
.gd-btn .material-symbols-outlined { font-size: 20px; }
.gd-btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.gd-btn-primary { background: #e4e4cc; color: #10120c; box-shadow: 0 16px 42px rgba(228,228,204,0.12); }
.gd-btn-primary:hover { transform: translateY(-2px); background: #f1f0db; box-shadow: 0 18px 48px rgba(228,228,204,0.16); }
.gd-btn-primary:active { transform: translateY(0); }
.gd-btn-primary:disabled { opacity: 0.75; cursor: progress; transform: none; box-shadow: none; }
.gd-variant-law .gd-btn-primary { background: var(--accent); color: #17110a; border-radius: 0.3rem; box-shadow: 0 14px 40px rgba(203,163,92,0.2); }
.gd-variant-law .gd-btn-primary:hover { background: #d8b877; }
.gd-btn-lg { padding: 1rem 1.9rem; font-size: 1.05rem; }
.gd-spinner { width: 18px; height: 18px; border-radius: 9999px; border: 2px solid rgba(27,29,14,0.25); border-top-color: #1b1d0e; animation: gd-spin 0.7s linear infinite; }
@keyframes gd-spin { to { transform: rotate(360deg); } }

/* Type */
.gd-eyebrow {
  font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.18em;
  text-transform: uppercase; color: var(--accent);
  display: inline-flex; align-items: center; border-radius: var(--radius-chip);
  background: var(--accent-soft); padding: 0.38rem 0.7rem;
}
.gd-instrument { letter-spacing: 0.16em; }
.gd-h1 {
  font-family: var(--font-display); font-weight: 600;
  font-size: clamp(2.3rem, 4.8vw, 3.9rem); line-height: 1.06; letter-spacing: -0.035em; margin: 1.25rem 0 0;
}
.gd-variant-medicine .gd-h1 {
  background: linear-gradient(135deg, #ffffff 8%, var(--accent) 82%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.gd-variant-law .gd-h1 { color: var(--on); font-weight: 500; letter-spacing: -0.02em; }
.gd-variant-law .gd-h1 em { font-style: italic; color: var(--accent); }
.gd-h2 { font-family: var(--font-display); font-weight: 600; font-size: clamp(1.7rem, 3.4vw, 2.6rem); line-height: 1.12; letter-spacing: -0.025em; margin: 0.6rem 0 0; }
.gd-variant-law .gd-h2 { font-weight: 500; letter-spacing: -0.015em; }
.gd-lead { font-size: clamp(1rem, 1.3vw, 1.18rem); line-height: 1.65; color: var(--on-dim); margin: 1.25rem 0 0; max-width: 48ch; }

/* Hero (shared bones) */
.gd-hero { max-width: 1240px; margin: 0 auto; padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 5vw, 4rem); }
.gd-hero-med { display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center; gap: clamp(2rem, 5vw, 5rem); }
.gd-actions { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2.25rem; }
.gd-hero-visual { display: flex; justify-content: center; }

/* Medicine hero specifics */
.gd-med-epigraph { margin: 0 0 1.5rem; padding-left: 1.15rem; border-left: 2px solid var(--accent); max-width: 34ch; }
.gd-med-epigraph blockquote { margin: 0; font-family: var(--font-quote); font-style: italic; font-size: clamp(1.15rem, 1.9vw, 1.55rem); line-height: 1.45; color: var(--on); }
.gd-med-epigraph figcaption { margin-top: 0.6rem; font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.gd-instrument-card { width: 100%; max-width: 480px; display: flex; flex-direction: column; gap: 0.75rem; }
.gd-vitals { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.9rem; padding: 0 0.4rem; font-family: var(--font-mono); font-size: 0.68rem; letter-spacing: 0.08em; color: var(--on-dim); }
.gd-vitals-item { position: relative; }
.gd-vitals-item + .gd-vitals-item::before { content: "·"; position: absolute; left: -0.6rem; color: var(--outline); }
.gd-vitals-dot { width: 8px; height: 8px; border-radius: 9999px; background: var(--accent-2); box-shadow: 0 0 10px var(--accent-2); animation: gd-bpm 0.83s ease-in-out infinite; }

/* Law hero specifics - centred masthead */
.gd-hero-law { max-width: 940px; text-align: center; }
.gd-masthead { display: flex; flex-direction: column; align-items: center; }
.gd-epigraph { margin: 0.5rem 0; max-width: 30ch; }
.gd-epigraph blockquote { margin: 0; font-family: var(--font-quote); font-style: italic; font-size: clamp(1.3rem, 2.6vw, 2rem); line-height: 1.4; color: var(--on); }
.gd-epigraph figcaption { margin-top: 0.75rem; font-family: var(--font-display); font-variant: small-caps; letter-spacing: 0.12em; font-size: 0.85rem; color: var(--accent); }
.gd-hero-law .gd-hero-kicker { margin-top: 1.75rem; }
.gd-hero-law .gd-h1 { margin-top: 0.5rem; }
.gd-hero-law .gd-lead { margin-left: auto; margin-right: auto; text-align: center; }
.gd-hero-law .gd-actions { justify-content: center; }
.gd-brief { margin: 2.75rem auto 0; max-width: 620px; }
.gd-brief .gd-preview { max-width: none; }

/* Law rules (hairlines) */
.gd-law-rule-top { border-top: 1px solid var(--outline); border-bottom: 1px solid var(--outline); padding: 0.55rem 0; }
.gd-law-rule-bottom { border-top: 1px solid var(--outline); border-bottom: 1px solid var(--outline); height: 3px; }
.gd-masthead .gd-law-rule-top { width: 100%; border-top: none; padding-top: 0; }
.gd-masthead .gd-law-rule-bottom { width: 100%; }
.gd-law-kicker { font-family: var(--font-display); font-variant: small-caps; letter-spacing: 0.14em; font-size: 0.95rem; color: var(--accent); }

/* Sections */
.gd-section { max-width: 1240px; margin: 0 auto; padding: clamp(2.75rem, 6vw, 5rem) clamp(1.25rem, 5vw, 4rem); }
.gd-section-narrow { max-width: 780px; }
.gd-variant-medicine .gd-section-narrow { text-align: center; }
.gd-variant-medicine .gd-section-narrow .gd-eyebrow { margin: 0 auto; }
.gd-variant-medicine .gd-section-narrow .gd-narrative { align-items: center; }
.gd-section-head { margin-bottom: 1.75rem; }
.gd-med-head .gd-pulse { margin-top: 1.1rem; opacity: 0.65; }
.gd-law-head .gd-h2 { margin: 0.9rem 0; }

/* ECG pulse */
.gd-pulse { display: block; width: 100%; height: 22px; }
.gd-pulse path { stroke: var(--accent); stroke-width: 1.5; vector-effect: non-scaling-stroke; stroke-dasharray: 720; stroke-dashoffset: 720; }
.gd-r.gd-in .gd-pulse path { animation: gd-ecg 1.4s ease forwards; }
.gd-instrument-card .gd-pulse { opacity: 0.5; }
.gd-instrument-card .gd-pulse path { animation: gd-ecg 1.6s ease 0.4s forwards; }
@keyframes gd-ecg { to { stroke-dashoffset: 0; } }
@keyframes gd-bpm { 0%, 45%, 100% { transform: scale(1); opacity: 0.9; } 20% { transform: scale(1.5); opacity: 1; } }

/* Narrative lines */
.gd-narrative { display: flex; flex-direction: column; gap: 0.55rem; margin-top: 0.75rem; }
.gd-line { margin: 0; font-family: var(--font-display); font-weight: 400; font-size: clamp(1.1rem, 1.7vw, 1.4rem); line-height: 1.45; color: var(--on); letter-spacing: -0.01em; }
.gd-line:last-child { color: var(--accent); font-weight: 500; }
.gd-more {
  align-self: flex-start; margin-top: 0.75rem;
  display: inline-flex; align-items: center; gap: 0.3rem;
  background: none; border: none; cursor: pointer; padding: 0.15rem 0;
  font-family: var(--font-mono, "JetBrains Mono", monospace); font-size: 0.72rem;
  letter-spacing: 0.08em; text-transform: uppercase; color: var(--accent);
  opacity: 0.85; transition: opacity 0.2s ease;
}
.gd-more:hover { opacity: 1; }
.gd-more .material-symbols-outlined { font-size: 16px; }
.gd-section-narrow .gd-more { align-self: center; }
.gd-variant-law .gd-line { font-family: var(--font-quote); font-style: italic; letter-spacing: 0; }
.gd-variant-law .gd-line:last-child { font-style: italic; }
.gd-variant-medicine .gd-section-narrow .gd-line { max-width: 42ch; }
.gd-variant-law .gd-section-narrow { max-width: 680px; }
.gd-variant-law .gd-narrative-feels .gd-line:first-child::first-letter {
  float: left; font-family: var(--font-display); font-style: normal; font-weight: 600;
  font-size: 3.4em; line-height: 0.72; padding: 0.05em 0.12em 0 0; color: var(--accent);
}

/* Split sections */
.gd-split { display: grid; grid-template-columns: 1fr 1fr; align-items: center; gap: clamp(2rem, 5vw, 4.5rem); }
.gd-split-visual { display: flex; flex-direction: column; gap: 1rem; }
.gd-split-flip .gd-split-copy { order: 2; }
.gd-split-flip .gd-split-visual { order: 1; }
.gd-split-copy .gd-narrative { margin-top: 1.25rem; }
.gd-split-copy .gd-line { font-size: clamp(1rem, 1.4vw, 1.18rem); }

/* Chat preview cards */
.gd-preview {
  width: 100%; max-width: 480px;
  background: linear-gradient(145deg, var(--accent-soft), transparent 46%), var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--outline-2));
  border-radius: var(--radius-card); padding: 1.5rem;
  display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 40px 120px rgba(0,0,0,0.6);
  transition: transform 0.3s ease, border-color 0.3s ease;
}
.gd-variant-medicine .gd-preview { box-shadow: 0 40px 120px rgba(0,0,0,0.6), 0 0 44px -14px var(--accent); }
.gd-variant-medicine .gd-preview:hover { transform: translateY(-4px); border-color: var(--outline); }
.gd-variant-law .gd-preview:hover { border-color: var(--accent); }
.gd-preview-q { display: flex; align-items: flex-start; gap: 0.75rem; background: var(--surface-3); border-radius: var(--radius-card) var(--radius-card) var(--radius-card) 0.3rem; padding: 1rem 1.25rem; color: var(--on); }
.gd-variant-law .gd-preview-q { border-radius: var(--radius-chip); }
.gd-preview-q .material-symbols-outlined { font-size: 20px; color: var(--on-dim); flex: none; }
.gd-preview-q p { margin: 0; font-size: 0.98rem; }
.gd-preview-a { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 55%, var(--yellow))); color: #12100a; border-radius: var(--radius-card) var(--radius-card) 0.3rem var(--radius-card); padding: 1.25rem 1.4rem; display: flex; flex-direction: column; gap: 0.75rem; }
.gd-variant-law .gd-preview-a { background: linear-gradient(135deg, var(--accent), var(--legal-cream)); color: #2a2214; border-radius: var(--radius-chip); }
.gd-pill-label { align-self: flex-start; font-family: var(--font-mono); font-size: 0.62rem; letter-spacing: 0.16em; text-transform: uppercase; background: rgba(27,29,14,0.14); padding: 0.3rem 0.7rem; border-radius: var(--radius-chip); }
.gd-preview-a p { margin: 0; font-size: 0.95rem; line-height: 1.55; font-weight: 500; }
.gd-sources { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.25rem; }
.gd-source-chip { display: inline-flex; align-items: center; gap: 0.4rem; background: rgba(27,29,14,0.1); border-radius: var(--radius-chip); padding: 0.35rem 0.75rem; font-family: var(--font-mono); font-size: 0.66rem; letter-spacing: 0.03em; }
.gd-source-chip .material-symbols-outlined { font-size: 14px; }
.gd-variant-law .gd-source-chip { background: transparent; border: 1px solid rgba(42,34,20,0.4); border-radius: 0.2rem; }
.gd-variant-law .gd-source-chip .material-symbols-outlined { display: none; }
.gd-variant-law .gd-source-chip::before { content: "["; }
.gd-variant-law .gd-source-chip::after { content: "]"; }
.gd-preview-na { display: flex; align-items: flex-start; gap: 0.7rem; border: 1px dashed var(--outline); border-radius: var(--radius-card) var(--radius-card) 0.3rem var(--radius-card); padding: 1.1rem 1.25rem; color: var(--on-dim); }
.gd-variant-law .gd-preview-na { border-radius: var(--radius-chip); }
.gd-preview-na .material-symbols-outlined { font-size: 20px; color: var(--accent); flex: none; opacity: 0.8; }
.gd-preview-na p { margin: 0; font-size: 0.92rem; line-height: 1.55; }
.gd-upload-note { display: flex; align-items: center; gap: 0.7rem; max-width: 480px; background: var(--surface); border: 1px solid var(--outline-2); border-radius: var(--radius-card); padding: 0.9rem 1.1rem; color: var(--on-dim); font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.03em; }
.gd-upload-note .material-symbols-outlined { font-size: 20px; color: var(--accent); flex: none; }
.gd-upload-note strong { color: var(--on); font-weight: 600; }

/* Quiz card */
.gd-quiz-card { width: 100%; max-width: 480px; background: var(--surface); border: 1px solid var(--outline-2); border-radius: var(--radius-card); padding: 1.4rem 1.5rem; display: flex; flex-direction: column; gap: 0.7rem; transition: transform 0.3s ease, border-color 0.3s ease; box-shadow: 0 40px 120px rgba(0,0,0,0.5); }
.gd-variant-medicine .gd-quiz-card:hover { transform: translateY(-4px); border-color: var(--outline); }
.gd-quiz-tag { font-family: var(--font-mono); font-size: 0.64rem; letter-spacing: 0.14em; text-transform: uppercase; color: var(--accent); }
.gd-quiz-q { margin: 0; font-family: var(--font-display); font-weight: 500; font-size: 1.02rem; line-height: 1.4; }
.gd-quiz-opt { border: 1px solid var(--outline-2); border-radius: var(--radius-chip); padding: 0.6rem 1.1rem; font-size: 0.9rem; color: var(--on-dim); display: flex; align-items: center; gap: 0.5rem; }
.gd-quiz-opt-right { background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 50%, #ffffff)); border-color: transparent; color: #10120c; font-weight: 600; }
.gd-quiz-opt-right .material-symbols-outlined { font-size: 18px; font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 24; }
.gd-quiz-grade { display: inline-flex; align-items: center; gap: 0.5rem; align-self: flex-start; background: var(--accent-soft); border-radius: var(--radius-chip); padding: 0.5rem 1rem; font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.04em; color: var(--accent); }
.gd-quiz-grade .material-symbols-outlined { font-size: 17px; }
/* Law: legal-pad quiz card */
.gd-variant-law .gd-quiz-card {
  background: var(--legal-cream); color: #2a2214; border-color: #d8c79a; padding-left: 2.3rem; position: relative;
  background-image: repeating-linear-gradient(var(--legal-cream), var(--legal-cream) 30px, #dcca9a 31px);
  box-shadow: 0 30px 80px rgba(0,0,0,0.45);
}
.gd-variant-law .gd-quiz-card::before { content: ""; position: absolute; left: 1.2rem; top: 0; bottom: 0; width: 1.5px; background: var(--accent-2); }
.gd-variant-law .gd-quiz-tag { color: #8a6d2f; }
.gd-variant-law .gd-quiz-q { color: #241d10; }
.gd-variant-law .gd-quiz-grade { background: rgba(158,59,52,0.12); color: #7a2f2a; }

/* CTA banner */
.gd-cta-banner {
  max-width: 1240px; margin: clamp(2rem, 5vw, 4rem) auto;
  padding: clamp(3rem, 6vw, 5rem) clamp(1.5rem, 5vw, 4rem);
  background: radial-gradient(circle at 50% 15%, var(--accent-soft), transparent 55%), var(--surface);
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--outline-2)); border-radius: var(--radius-card);
  text-align: center; display: flex; flex-direction: column; align-items: center;
}
.gd-cta-narrative { margin: 1.5rem 0 2rem; }
.gd-cta-narrative .gd-narrative { align-items: center; }
.gd-cta-narrative .gd-line { max-width: 42ch; }
.gd-switch-link { margin-top: 1.5rem; background: none; border: none; cursor: pointer; font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--on-dim); text-decoration: underline; text-underline-offset: 4px; transition: color 0.2s ease; }
.gd-switch-link:hover { color: var(--accent); }

/* Footer */
.gd-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; padding: 2rem clamp(1.25rem, 5vw, 4rem); border-top: 1px solid var(--outline-2); }
.gd-logo-sm { font-size: 1.1rem; }
.gd-footer-meta { font-family: var(--font-mono); font-size: 0.7rem; letter-spacing: 0.06em; color: var(--on-dim); text-transform: uppercase; }
.gd-footer-meta:last-child { margin-left: auto; }

/* Chooser */
.gd-chooser { display: flex; align-items: center; justify-content: center; padding: 2rem 1.25rem;
  background: radial-gradient(circle at 20% 20%, rgba(63,218,200,0.1), transparent 34rem), radial-gradient(circle at 80% 80%, rgba(203,163,92,0.1), transparent 34rem), #08080a; }
.gd-chooser-inner { position: relative; z-index: 1; width: 100%; max-width: 900px; text-align: center; display: flex; flex-direction: column; align-items: center; }
.gd-chooser-logo { font-family: "Schibsted Grotesk", sans-serif; font-size: 2rem; margin-bottom: 1.5rem; color: #e9e7e3; }
.gd-chooser-h1 { font-family: "Schibsted Grotesk", sans-serif; font-weight: 600; font-size: clamp(2rem, 4.5vw, 3.2rem); line-height: 1.08; letter-spacing: -0.03em; margin: 0; color: #f4f2ee; }
.gd-chooser-sub { margin: 1rem auto 0; max-width: 48ch; color: #a7a59d; font-size: 1.05rem; line-height: 1.6; }
.gd-chooser-grid { margin-top: 2.75rem; width: 100%; display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem; }
.gd-choice {
  position: relative; cursor: pointer; text-align: left; display: flex; flex-direction: column; gap: 0.75rem;
  padding: 2.25rem 2rem; border-radius: var(--radius-card);
  background: linear-gradient(155deg, var(--accent-soft), transparent 48%), var(--surface);
  border: 1px solid var(--outline); color: var(--on);
  transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.3s ease;
}
.gd-choice:hover { transform: translateY(-4px); border-color: var(--accent); box-shadow: 0 30px 90px rgba(0,0,0,0.5); }
.gd-choice-icon { font-size: 40px; color: var(--accent); width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; background: var(--accent-soft); border-radius: var(--radius-card); }
.gd-choice-title { font-family: var(--font-display); font-weight: 600; font-size: 1.7rem; letter-spacing: -0.02em; color: var(--on); }
.gd-choice-blurb { color: var(--on-dim); font-size: 0.95rem; line-height: 1.5; }
.gd-choice-go { margin-top: 0.5rem; display: inline-flex; align-items: center; gap: 0.4rem; font-family: var(--font-mono); font-size: 0.72rem; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); }
.gd-choice-go .material-symbols-outlined { font-size: 16px; transition: transform 0.2s ease; }
.gd-choice:hover .gd-choice-go .material-symbols-outlined { transform: translateX(4px); }
.gd-chooser-foot { margin-top: 2rem; font-family: "IBM Plex Mono", monospace; font-size: 0.7rem; letter-spacing: 0.08em; text-transform: uppercase; color: #7d7b74; }

/* Entrance + reveals */
@media (prefers-reduced-motion: no-preference) {
  .gd-rise { animation: gd-rise var(--gd-dur) var(--gd-ease) both; }
  .gd-rise-1 { animation-delay: 0.05s; }
  .gd-rise-2 { animation-delay: 0.15s; }
  .gd-rise-3 { animation-delay: 0.28s; }
  .gd-rise-4 { animation-delay: 0.4s; }
  .gd-rise-5 { animation-delay: 0.52s; }
  .gd-r { opacity: 0; transform: translateY(var(--gd-rise)); transition: opacity var(--gd-dur) ease, transform calc(var(--gd-dur) + 0.05s) var(--gd-ease); transition-delay: var(--rd, 0s); }
  .gd-r.gd-in { opacity: 1; transform: none; }
}
@keyframes gd-rise { from { opacity: 0; transform: translateY(var(--gd-rise)); } to { opacity: 1; transform: none; } }

/* Responsive */
@media (max-width: 880px) {
  .gd-hero-med { grid-template-columns: 1fr; padding-top: 2.5rem; }
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
  .gd-vitals-dot { animation: none; }
  .gd-pulse path { stroke-dashoffset: 0 !important; animation: none !important; }
  .gd-preview:hover, .gd-quiz-card:hover, .gd-choice:hover, .gd-btn-primary:hover { transform: none; }
}
`;
