import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D — pinpoint answers from large files" },
      {
        name: "description",
        content:
          "Upload huge PDFs, notes, and scans, then ask one precise question. G&D returns the exact answer, the source page, and the evidence — in seconds.",
      },
    ],
  }),
  component: Landing,
});

// Landing / hub for "/" — the first screen users see. Symbiote Organicism
// aesthetic (deep black + warm beige, pill shapes, Sora / Hanken Grotesk /
// JetBrains Mono) but built as a real responsive web page: two-column hero on
// desktop, single-column stack on mobile. Self-contained styles + Google Fonts
// (React 19 hoists the <link>/<style> into <head>); no new deps.
const features = [
  {
    icon: "target",
    title: "Pinpoint Chat",
    body: "Ask huge files one question and get the exact passage back, with the page it came from.",
    to: "/app/chat" as const,
    cta: "Start asking",
  },
  {
    icon: "folder_open",
    title: "Document Library",
    body: "Drop in PDFs, lecture notes, slide decks, and scans. Everything becomes searchable.",
    to: "/app/library" as const,
    cta: "Open library",
  },
  {
    icon: "school",
    title: "StudyBody Coach",
    body: "Turn your material into a roadmap, get quizzed, and have your answers graded.",
    to: "/app/studybody" as const,
    cta: "Train with coach",
  },
  {
    icon: "hub",
    title: "Find Connections",
    body: "Link ideas across subjects and folders so concepts actually stick together.",
    to: "/app/chat" as const,
    cta: "Connect ideas",
  },
];

const steps = [
  { n: "01", label: "Upload", body: "Add your files. G&D extracts the text so every page is searchable." },
  { n: "02", label: "Pinpoint", body: "Ask for the exact thing. We find the passage, page, and file." },
  { n: "03", label: "Answer", body: "Evidence first, then a clear explanation in your chosen style." },
];

function Landing() {
  return (
    <div className="gd-root">
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
        <nav className="gd-nav-links">
          <Link to="/app/chat" className="gd-nav-link">Chat</Link>
          <Link to="/app/library" className="gd-nav-link">Library</Link>
          <Link to="/app/studybody" className="gd-nav-link">Coach</Link>
        </nav>
        <Link to="/auth" search={{ mode: "signup" }} className="gd-btn gd-btn-primary gd-nav-cta">
          Get started
        </Link>
      </header>

      <main>
        {/* Hero */}
        <section className="gd-hero">
          <div className="gd-hero-copy">
            <span className="gd-eyebrow">Precision search for your study files</span>
            <h1 className="gd-h1">
              Ask huge files one&nbsp;question. Get the <span className="gd-accent">exact answer</span> back.
            </h1>
            <p className="gd-lead">
              Upload notes, PDFs, and slide decks, then ask for the detail buried inside. G&amp;D
              pins down the right passage, shows where it came from, and explains only after the
              evidence is locked.
            </p>
            <div className="gd-actions">
              <Link to="/auth" search={{ mode: "signup" }} className="gd-btn gd-btn-primary">
                <span className="material-symbols-outlined">search</span>
                Search your files
              </Link>
              <Link to="/auth" className="gd-btn gd-btn-ghost">
                Enter workspace
                <span className="material-symbols-outlined">arrow_forward</span>
              </Link>
            </div>
            <div className="gd-trust">
              <span className="material-symbols-outlined">verified</span>
              Source-backed answers, page-aware citations
            </div>
          </div>

          {/* Product preview card */}
          <div className="gd-preview" aria-hidden="true">
            <div className="gd-preview-q">
              <span className="material-symbols-outlined">person</span>
              <p>Where does the text define synaptic pruning?</p>
            </div>
            <div className="gd-preview-a">
              <span className="gd-pill-label">Exact answer</span>
              <p>
                Synaptic pruning is the elimination of weaker synaptic connections while
                frequently-used ones are strengthened — refining neural networks during
                adolescence.
              </p>
              <div className="gd-sources">
                <span className="gd-source-chip">
                  <span className="material-symbols-outlined">description</span>
                  p. 142 · neuroscience_v3.pdf
                </span>
                <span className="gd-source-chip">
                  <span className="material-symbols-outlined">link</span>
                  Fig 4.2 · Structural Maturation
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* Feature grid */}
        <section className="gd-section">
          <div className="gd-section-head">
            <span className="gd-eyebrow">One workspace</span>
            <h2 className="gd-h2">Everything points back to your sources.</h2>
          </div>
          <div className="gd-grid">
            {features.map((f) => (
              <Link key={f.title} to={f.to} className="gd-card">
                <span className="gd-card-icon material-symbols-outlined">{f.icon}</span>
                <h3 className="gd-card-title">{f.title}</h3>
                <p className="gd-card-body">{f.body}</p>
                <span className="gd-card-cta">
                  {f.cta}
                  <span className="material-symbols-outlined">arrow_forward</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section className="gd-section">
          <div className="gd-section-head">
            <span className="gd-eyebrow">How it works</span>
            <h2 className="gd-h2">Three steps from file to answer.</h2>
          </div>
          <div className="gd-steps">
            {steps.map((s) => (
              <div key={s.n} className="gd-step">
                <span className="gd-step-n">{s.n}</span>
                <h3 className="gd-step-label">{s.label}</h3>
                <p className="gd-step-body">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA banner */}
        <section className="gd-cta-banner">
          <h2 className="gd-h2">Stop scrolling. Start pinpointing.</h2>
          <p className="gd-lead">Bring your hardest file and ask it the question that matters.</p>
          <Link to="/auth" search={{ mode: "signup" }} className="gd-btn gd-btn-primary">
            <span className="material-symbols-outlined">bolt</span>
            Get started free
          </Link>
        </section>
      </main>

      <footer className="gd-footer">
        <span className="gd-logo gd-logo-sm">G&amp;D</span>
        <span className="gd-footer-meta">Precision answers from your own material</span>
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
  position: relative;
  min-height: 100dvh;
  overflow-x: hidden;
  background: var(--bg);
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
  background: radial-gradient(circle, rgba(228,228,204,0.18), transparent 70%);
  animation: gd-float-1 22s ease-in-out infinite;
}
.gd-blob-2 {
  bottom: -15%; left: -10%;
  width: 50vw; height: 50vw; max-width: 700px; max-height: 700px;
  background: radial-gradient(circle, rgba(120,130,110,0.14), transparent 70%);
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
  font-family: "Hanken Grotesk", sans-serif; font-weight: 600; font-size: 0.98rem;
  text-decoration: none; cursor: pointer; white-space: nowrap;
  transition: transform 0.2s ease, background 0.25s ease, border-color 0.25s ease, color 0.25s ease;
}
.gd-btn .material-symbols-outlined { font-size: 20px; }
.gd-btn-primary { background: var(--beige); color: var(--on-beige); }
.gd-btn-primary:hover { background: var(--beige-dim); transform: translateY(-2px); }
.gd-btn-ghost { background: transparent; color: var(--on); border: 1px solid var(--outline); }
.gd-btn-ghost:hover { border-color: var(--beige); color: var(--beige); }

/* Shared type */
.gd-eyebrow {
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--beige-dim);
}
.gd-h1 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(2.4rem, 5.5vw, 4.4rem); line-height: 1.04;
  letter-spacing: -0.035em; margin: 1rem 0 0;
}
.gd-h2 {
  font-family: "Sora", sans-serif; font-weight: 600;
  font-size: clamp(1.7rem, 3.5vw, 2.6rem); line-height: 1.1;
  letter-spacing: -0.025em; margin: 0.75rem 0 0;
}
.gd-accent { color: var(--beige); }
.gd-lead {
  font-size: clamp(1rem, 1.3vw, 1.18rem); line-height: 1.6;
  color: var(--on-dim); margin: 1.25rem 0 0; max-width: 42ch;
}

/* Hero */
.gd-hero {
  display: grid; grid-template-columns: 1.05fr 0.95fr; align-items: center;
  gap: clamp(2rem, 5vw, 5rem);
  padding: clamp(3rem, 7vw, 6rem) clamp(1.25rem, 5vw, 4rem);
  max-width: 1240px; margin: 0 auto;
}
.gd-actions { display: flex; flex-wrap: wrap; gap: 1rem; margin-top: 2rem; }
.gd-trust {
  display: inline-flex; align-items: center; gap: 0.5rem; margin-top: 1.75rem;
  font-family: "JetBrains Mono", monospace; font-size: 0.72rem;
  letter-spacing: 0.06em; color: var(--on-dim); text-transform: uppercase;
}
.gd-trust .material-symbols-outlined { font-size: 18px; color: var(--beige-dim); }

/* Product preview */
.gd-preview {
  background: var(--surface);
  border: 1px solid var(--outline-2);
  border-radius: 2rem; padding: 1.5rem;
  display: flex; flex-direction: column; gap: 1rem;
  box-shadow: 0 40px 120px rgba(0,0,0,0.6);
}
.gd-preview-q {
  display: flex; align-items: flex-start; gap: 0.75rem;
  background: var(--surface-3); border-radius: 1.25rem 1.25rem 1.25rem 0.4rem;
  padding: 1rem 1.25rem; color: var(--on);
}
.gd-preview-q .material-symbols-outlined { font-size: 20px; color: var(--on-dim); }
.gd-preview-q p { margin: 0; font-size: 0.98rem; }
.gd-preview-a {
  background: var(--beige); color: var(--on-beige);
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

/* Sections */
.gd-section { max-width: 1240px; margin: 0 auto; padding: clamp(2.5rem, 5vw, 4.5rem) clamp(1.25rem, 5vw, 4rem); }
.gd-section-head { max-width: 40ch; margin-bottom: 2.5rem; }
.gd-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1.25rem; }
.gd-card {
  display: flex; flex-direction: column; gap: 0.75rem;
  background: var(--surface); border: 1px solid var(--outline-2);
  border-radius: 1.75rem; padding: 1.75rem;
  text-decoration: none; color: var(--on);
  transition: transform 0.25s ease, border-color 0.25s ease, background 0.25s ease;
}
.gd-card:hover { transform: translateY(-4px); border-color: var(--outline); background: var(--surface-3); }
.gd-card-icon {
  font-size: 30px; color: var(--beige);
  width: 56px; height: 56px; display: flex; align-items: center; justify-content: center;
  background: rgba(228,228,204,0.08); border-radius: 9999px; margin-bottom: 0.25rem;
}
.gd-card-title { font-family: "Sora", sans-serif; font-weight: 500; font-size: 1.2rem; margin: 0; }
.gd-card-body { margin: 0; color: var(--on-dim); font-size: 0.95rem; line-height: 1.55; flex: 1; }
.gd-card-cta {
  display: inline-flex; align-items: center; gap: 0.4rem; margin-top: 0.5rem;
  color: var(--beige); font-weight: 600; font-size: 0.9rem;
}
.gd-card-cta .material-symbols-outlined { font-size: 18px; transition: transform 0.2s ease; }
.gd-card:hover .gd-card-cta .material-symbols-outlined { transform: translateX(4px); }

/* Steps */
.gd-steps { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1.25rem; }
.gd-step {
  border-top: 1px solid var(--outline); padding-top: 1.25rem;
  display: flex; flex-direction: column; gap: 0.5rem;
}
.gd-step-n {
  font-family: "JetBrains Mono", monospace; font-size: 0.8rem;
  letter-spacing: 0.1em; color: var(--beige-dim);
}
.gd-step-label { font-family: "Sora", sans-serif; font-weight: 500; font-size: 1.35rem; margin: 0; }
.gd-step-body { margin: 0; color: var(--on-dim); font-size: 0.95rem; line-height: 1.55; }

/* CTA banner */
.gd-cta-banner {
  max-width: 1240px; margin: 0 auto clamp(2rem, 5vw, 4rem);
  padding: clamp(2.5rem, 5vw, 4rem) clamp(1.5rem, 5vw, 4rem);
  background:
    radial-gradient(circle at 80% 20%, rgba(228,228,204,0.1), transparent 60%),
    var(--surface);
  border: 1px solid var(--outline-2); border-radius: 2.5rem;
  text-align: center; display: flex; flex-direction: column; align-items: center;
}
.gd-cta-banner .gd-lead { margin-bottom: 1.75rem; }

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
  .gd-hero { grid-template-columns: 1fr; }
  .gd-preview { order: -1; }
  .gd-nav-links { display: none; }
}
@media (max-width: 480px) {
  .gd-actions .gd-btn { flex: 1; }
  .gd-footer-meta:last-child { margin-left: 0; width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .gd-blob { animation: none; }
}
`;
