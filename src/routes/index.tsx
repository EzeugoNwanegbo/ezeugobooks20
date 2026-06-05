import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - Document Library" },
      {
        name: "description",
        content:
          "Your academic archive. Search, organize, and pinpoint answers across PDFs, notes, and scans with G&D.",
      },
    ],
  }),
  component: Landing,
});

// Home/hub screen — the first thing users see. Built from the Stitch
// "Document Library" design (Symbiote Organicism system: deep black + warm
// beige, Sora / Hanken Grotesk / JetBrains Mono, pill shapes). Cards and the
// bottom nav route into the app (Library / Chat / Coach).
function Landing() {
  return (
    <div className="dl-root">
      {/* Fonts + scoped styles (React hoists these into <head>). */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600&family=Hanken+Grotesk:wght@400;500;700&family=JetBrains+Mono:wght@400;500&display=swap"
      />
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
      />
      <style>{DL_CSS}</style>

      <main className="dl-shell">
        {/* Header */}
        <header className="dl-header">
          <div>
            <h1 className="dl-title">Document Library</h1>
            <p className="dl-subtitle">
              Manage your academic archives and research materials.
            </p>
          </div>
          <Link to="/app/library" className="dl-ghost-btn">
            SELECT
          </Link>
        </header>

        {/* Search */}
        <Link to="/app/library" className="dl-search">
          <span className="material-symbols-outlined">search</span>
          <span className="dl-search-text">Search archive...</span>
        </Link>

        {/* Add new */}
        <Link to="/app/library" className="dl-primary-btn">
          <span className="material-symbols-outlined">add</span>
          ADD NEW
        </Link>
        <p className="dl-caption dl-center">MAX FILE SIZE: 40MB</p>

        {/* Folders */}
        <section className="dl-card dl-folders">
          <div className="dl-folders-head">
            <span className="dl-caption">FOLDERS</span>
            <span className="material-symbols-outlined dl-muted">shuffle</span>
          </div>

          <Link to="/app/library" className="dl-folder-row dl-folder-active">
            <span className="material-symbols-outlined">folder</span>
            <span className="dl-folder-name">Anatomy</span>
            <span className="dl-folder-count">12</span>
          </Link>
          <Link to="/app/library" className="dl-folder-row">
            <span className="material-symbols-outlined">folder</span>
            <span className="dl-folder-name">Clinical Practice</span>
            <span className="dl-folder-count">08</span>
          </Link>
          <Link to="/app/library" className="dl-folder-row">
            <span className="material-symbols-outlined">folder</span>
            <span className="dl-folder-name">Pharmacology</span>
            <span className="dl-folder-count">24</span>
          </Link>

          <div className="dl-divider" />

          <span className="dl-caption">AI SUGGESTION</span>
          <div className="dl-suggestion">
            <p className="dl-suggestion-label">Based on your recent scans:</p>
            <Link to="/app/library" className="dl-chip">
              <span className="material-symbols-outlined">folder_special</span>
              Medical Ethics 2024
            </Link>
          </div>
        </section>

        {/* Document card — indexed PDF */}
        <Link to="/app/library" className="dl-card dl-doc">
          <div className="dl-doc-media dl-media-heart">
            <span className="material-symbols-outlined dl-media-icon">cardiology</span>
            <span className="dl-tag">INDEXED</span>
          </div>
          <div className="dl-doc-body">
            <h2 className="dl-doc-title">Cardiovascular System Notes</h2>
            <p className="dl-doc-desc">
              Detailed breakdown of ventricular hypertrophy and aortic valve pathology.
            </p>
            <div className="dl-doc-foot">
              <span className="dl-meta">
                <span className="material-symbols-outlined">picture_as_pdf</span>
                PDF
              </span>
              <span className="dl-meta">2.4 MB</span>
            </div>
          </div>
        </Link>

        {/* Document card — extracted image (OCR) */}
        <Link to="/app/library" className="dl-card dl-doc">
          <div className="dl-doc-media dl-media-scan">
            <span className="material-symbols-outlined dl-media-icon">monitor_heart</span>
            <span className="dl-tag">EXTRACTED</span>
          </div>
          <div className="dl-doc-body">
            <h2 className="dl-doc-title">Lab Report: Lipid Panel</h2>
            <p className="dl-doc-desc">
              OCR scan from clinical rotation at Mercy Hospital. Analysis complete.
            </p>
            <div className="dl-doc-foot">
              <span className="dl-meta">
                <span className="material-symbols-outlined">image</span>
                IMAGE (OCR)
              </span>
              <span className="dl-meta">4.1 MB</span>
            </div>
          </div>
        </Link>

        {/* Upload */}
        <Link to="/app/library" className="dl-upload">
          <span className="material-symbols-outlined dl-upload-icon">upload_file</span>
          <span className="dl-caption">DRAG &amp; DROP TO UPLOAD</span>
          <span className="dl-caption dl-muted">MAX 40MB</span>
        </Link>
      </main>

      {/* Bottom nav */}
      <nav className="dl-nav">
        <div className="dl-nav-inner">
          <Link to="/app/chat" className="dl-nav-item">
            <span className="material-symbols-outlined">chat_bubble</span>
            <span className="dl-nav-label">Chat</span>
          </Link>
          <Link to="/app/library" className="dl-nav-item dl-nav-active">
            <span className="material-symbols-outlined">folder_open</span>
            <span className="dl-nav-label">Library</span>
          </Link>
          <Link to="/app/chat" className="dl-nav-item">
            <span className="material-symbols-outlined">hub</span>
            <span className="dl-nav-label">Links</span>
          </Link>
          <Link to="/app/studybody" className="dl-nav-item">
            <span className="material-symbols-outlined">school</span>
            <span className="dl-nav-label">Coach</span>
          </Link>
        </div>
      </nav>
    </div>
  );
}

const DL_CSS = `
.dl-root {
  --bg: #000000;
  --surface: #131313;
  --surface-low: #0a0a0a;
  --surface-container: #1c1b1b;
  --surface-high: #2a2a2a;
  --surface-highest: #353535;
  --on-surface: #e5e2e1;
  --on-surface-variant: #c8c7bc;
  --outline: #929187;
  --outline-variant: #47473f;
  --beige: #e4e4cc;
  --beige-dim: #c8c8b0;
  --on-beige: #1b1d0e;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--on-surface);
  font-family: "Hanken Grotesk", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
.dl-root .material-symbols-outlined {
  font-family: "Material Symbols Outlined";
  font-weight: normal;
  font-style: normal;
  font-size: 22px;
  line-height: 1;
  letter-spacing: normal;
  text-transform: none;
  display: inline-block;
  white-space: nowrap;
  word-wrap: normal;
  direction: ltr;
  font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
}
.dl-shell {
  max-width: 480px;
  margin: 0 auto;
  padding: 2.5rem 1.5rem 8rem;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
.dl-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.dl-title {
  font-family: "Sora", sans-serif;
  font-size: 34px;
  font-weight: 600;
  line-height: 1.05;
  letter-spacing: -0.03em;
  margin: 0;
  color: var(--on-surface);
}
.dl-subtitle {
  margin: 0.5rem 0 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--on-surface-variant);
  max-width: 16rem;
}
.dl-ghost-btn {
  flex-shrink: 0;
  border: 1px solid var(--outline);
  color: var(--on-surface);
  border-radius: 9999px;
  padding: 0.5rem 1rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-decoration: none;
  transition: background 0.3s ease, color 0.3s ease;
}
.dl-ghost-btn:hover { background: var(--beige); color: var(--on-beige); border-color: var(--beige); }
.dl-search {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  background: var(--surface-low);
  border: 1px solid var(--outline-variant);
  border-radius: 9999px;
  padding: 1rem 1.5rem;
  text-decoration: none;
  transition: border-color 0.3s ease;
}
.dl-search:hover { border-color: var(--outline); }
.dl-search .material-symbols-outlined { color: var(--outline); }
.dl-search-text { color: var(--outline); font-size: 15px; }
.dl-primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  background: var(--beige);
  color: var(--on-beige);
  border-radius: 9999px;
  padding: 1rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  letter-spacing: 0.06em;
  font-weight: 500;
  text-decoration: none;
  transition: transform 0.2s ease, background 0.3s ease;
}
.dl-primary-btn:hover { background: var(--beige-dim); transform: translateY(-1px); }
.dl-primary-btn .material-symbols-outlined { font-size: 18px; }
.dl-caption {
  font-family: "JetBrains Mono", monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--outline);
  text-transform: uppercase;
}
.dl-center { text-align: center; }
.dl-muted { color: var(--outline); opacity: 0.7; }
.dl-card {
  background: var(--surface);
  border-radius: 1.5rem;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
}
.dl-folders {
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dl-folders-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.dl-folder-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-radius: 9999px;
  text-decoration: none;
  color: var(--on-surface-variant);
  transition: background 0.3s ease, color 0.3s ease;
}
.dl-folder-row:hover { background: var(--surface-high); color: var(--on-surface); }
.dl-folder-active {
  background: var(--beige);
  color: var(--on-beige);
}
.dl-folder-active:hover { background: var(--beige); color: var(--on-beige); }
.dl-folder-name { flex: 1; font-size: 15px; font-weight: 500; }
.dl-folder-count {
  font-family: "JetBrains Mono", monospace;
  font-size: 13px;
  opacity: 0.8;
}
.dl-divider {
  height: 1px;
  background: linear-gradient(to right, transparent, var(--outline-variant), transparent);
  margin: 1rem 0 0.75rem;
}
.dl-suggestion {
  background: var(--surface-low);
  border-radius: 1rem;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.dl-suggestion-label { margin: 0; font-size: 13px; color: var(--on-surface-variant); }
.dl-chip {
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  background: var(--surface-high);
  border: 1px solid var(--outline-variant);
  border-radius: 9999px;
  padding: 0.5rem 1rem;
  font-size: 13px;
  color: var(--on-surface);
  text-decoration: none;
}
.dl-chip .material-symbols-outlined { font-size: 16px; color: var(--beige-dim); }
.dl-doc { display: flex; flex-direction: column; transition: transform 0.2s ease; }
.dl-doc:hover { transform: translateY(-2px); }
.dl-doc-media {
  position: relative;
  height: 150px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dl-media-heart {
  background:
    radial-gradient(circle at 50% 40%, #2a2a2a 0%, #0a0a0a 70%);
}
.dl-media-scan {
  background: linear-gradient(135deg, #d6d6d0 0%, #b8b8b0 100%);
}
.dl-media-icon { font-size: 64px; opacity: 0.55; }
.dl-media-heart .dl-media-icon { color: #e5e2e1; }
.dl-media-scan .dl-media-icon { color: #4a4949; }
.dl-tag {
  position: absolute;
  top: 0.85rem;
  right: 0.85rem;
  background: rgba(8, 8, 8, 0.75);
  backdrop-filter: blur(6px);
  border: 1px solid var(--outline-variant);
  border-radius: 9999px;
  padding: 0.3rem 0.7rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: var(--beige-dim);
}
.dl-doc-body { padding: 1.25rem 1.5rem 1.5rem; display: flex; flex-direction: column; gap: 0.5rem; }
.dl-doc-title { font-family: "Sora", sans-serif; font-size: 19px; font-weight: 500; margin: 0; color: var(--on-surface); }
.dl-doc-desc { margin: 0; font-size: 14px; line-height: 1.5; color: var(--on-surface-variant); }
.dl-doc-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 0.75rem;
}
.dl-meta {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: "JetBrains Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: var(--outline);
}
.dl-meta .material-symbols-outlined { font-size: 16px; }
.dl-upload {
  border: 1.5px dashed var(--outline-variant);
  border-radius: 1.5rem;
  padding: 2.5rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-decoration: none;
  transition: border-color 0.3s ease, background 0.3s ease;
}
.dl-upload:hover { border-color: var(--outline); background: var(--surface-low); }
.dl-upload-icon { font-size: 30px; color: var(--outline); }
.dl-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  background: var(--surface-low);
  border-top: 1px solid var(--outline-variant);
}
.dl-nav-inner {
  max-width: 480px;
  margin: 0 auto;
  display: flex;
  justify-content: space-around;
  align-items: center;
  padding: 0.6rem 1rem calc(0.6rem + env(safe-area-inset-bottom));
}
.dl-nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.2rem;
  padding: 0.5rem 1rem;
  border-radius: 9999px;
  text-decoration: none;
  color: var(--on-surface-variant);
  transition: color 0.3s ease;
}
.dl-nav-item:hover { color: var(--on-surface); }
.dl-nav-active { background: var(--beige); color: var(--on-beige); }
.dl-nav-active:hover { color: var(--on-beige); }
.dl-nav-label { font-family: "JetBrains Mono", monospace; font-size: 10px; letter-spacing: 0.04em; }
`;
