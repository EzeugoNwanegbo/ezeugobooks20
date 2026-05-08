import { createFileRoute, Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - pinpoint answers from large files" },
      {
        name: "description",
        content:
          "Ask huge PDFs and notes precise questions. G&D finds the exact answer, source, and evidence in seconds.",
      },
    ],
  }),
  component: Landing,
});

const cards = [
  {
    label: "01 / Upload",
    title: "Large files become searchable.",
    body: "Drop in PDFs, lecture notes, slide decks, or chapters. G&D extracts the text so every question can point back to the right source.",
  },
  {
    label: "02 / Pinpoint",
    title: "Ask for the exact thing.",
    body: "Search across long files in seconds and return the passages, page labels, and file names that actually answer the question.",
  },
  {
    label: "03 / Answer",
    title: "Evidence first, explanation next.",
    body: "Get the direct answer first, then the supporting source trail, then a clear explanation when you want the concept to stick.",
  },
];

function Landing() {
  return (
    <main className="luxury-page">
      <div className="symbiote-blob blob-one" />
      <div className="symbiote-blob blob-two" />
      <div className="symbiote-blob blob-three" />

      <nav className="luxury-nav" aria-label="Primary navigation">
        <Link to="/" className="luxury-logo">
          G&D
        </Link>
        <ThemeToggle />
      </nav>

      <section className="luxury-hero" id="method">
        <p className="luxury-eyebrow">Precision search for your study files</p>
        <h1>Ask huge files one question. Get the exact answer back.</h1>
        <p className="luxury-copy">
          Upload notes, PDFs, or slide decks and ask for the detail buried inside. G&D finds the
          right passage, shows where it came from, and explains only after the evidence is pinned
          down.
        </p>
        <div className="luxury-actions">
          <Link to="/auth" search={{ mode: "signup" }} className="luxury-primary">
            Search your files
          </Link>
          <Link to="/auth" className="luxury-ghost">
            Enter workspace <span aria-hidden="true">-&gt;</span>
          </Link>
        </div>
      </section>

      <section className="luxury-card-grid" id="library" aria-label="Study workflow">
        {cards.map((card) => (
          <article className="luxury-card" key={card.title}>
            <p>{card.label}</p>
            <h2>{card.title}</h2>
            <span>{card.body}</span>
          </article>
        ))}
      </section>

      <footer className="luxury-footer" id="practice">
        <div className="luxury-status">
          <span className="availability-dot" />
          Library active
        </div>
        <div className="luxury-ticker" aria-hidden="true">
          <div>
            <span>selected PDFs</span>
            <span>exact passages</span>
            <span>page-aware answers</span>
            <span>source-backed evidence</span>
            <span>selected PDFs</span>
            <span>exact passages</span>
            <span>page-aware answers</span>
            <span>source-backed evidence</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
