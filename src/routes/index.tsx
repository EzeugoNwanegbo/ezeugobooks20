import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D - quiet intelligence for medical study" },
      {
        name: "description",
        content:
          "A restrained, document-aware medical study interface for reading, questioning, and remembering your own notes.",
      },
    ],
  }),
  component: Landing,
});

const cards = [
  {
    label: "01 / Library",
    title: "Your files stay close to the answer.",
    body: "Choose the exact PDF, note, or textbook chapter you want to study. If you do not choose, the library quietly selects the closest source.",
  },
  {
    label: "02 / Retrieval",
    title: "The page matters before the model speaks.",
    body: "Long documents are split into searchable passages, then only the relevant fragments are sent forward for a calmer, more precise response.",
  },
  {
    label: "03 / Tutor",
    title: "Depth when needed, restraint when not.",
    body: "Move between simplified explanation, clinical detail, and story-led memory without losing the source trail beneath the answer.",
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
      </nav>

      <section className="luxury-hero" id="method">
        <p className="luxury-eyebrow">Document-aware study system</p>
        <h1>
          Medicine feels clearer when the textbook <em>breathes back</em>.
        </h1>
        <p className="luxury-copy">
          Upload notes, choose the file in front of you, and let the interface pull the right
          passage before the AI explains. Quiet, source-led, and built for serious study.
        </p>
        <div className="luxury-actions">
          <Link to="/auth" search={{ mode: "signup" }} className="luxury-primary">
            Begin studying
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
            <span>chunked passages</span>
            <span>quiet recall</span>
            <span>source-first answers</span>
            <span>selected PDFs</span>
            <span>chunked passages</span>
            <span>quiet recall</span>
            <span>source-first answers</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
