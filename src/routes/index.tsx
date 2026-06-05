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

// Stripped-down home screen used as a deploy smoke test: just the G&D logo and
// an inline venom-style mascot so it's instantly obvious whether a push reached
// the live site.
function VenomMascot() {
  return (
    <svg
      width="200"
      height="240"
      viewBox="0 0 200 240"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label="G&D venom mascot"
      role="img"
    >
      {/* head */}
      <path
        d="M100 8c-44 0-78 30-78 78 0 40 20 74 48 100 8 8 14 14 30 14s22-6 30-14c28-26 48-60 48-100 0-48-34-78-78-78z"
        fill="#0a0a0a"
      />
      {/* glossy highlight */}
      <ellipse cx="78" cy="60" rx="20" ry="34" fill="#1f1f1f" opacity="0.6" />
      {/* left eye */}
      <path d="M40 78c14-16 38-12 44 6-10 14-44 16-44-6z" fill="#fff" />
      {/* right eye */}
      <path d="M160 78c-14-16-38-12-44 6 10 14 44 16 44-6z" fill="#fff" />
      {/* mouth */}
      <path d="M52 132c20 22 76 22 96 0-18 34-78 34-96 0z" fill="#0a0a0a" />
      {/* teeth */}
      <path
        d="M58 134l8 16 8-16 8 16 8-16 8 16 8-16 8 16 8-16 8 16 8-16 8 16 8-16"
        stroke="#fff"
        strokeWidth="3"
        fill="none"
        strokeLinejoin="round"
      />
      {/* tongue */}
      <path
        d="M96 150c0 30-20 46-20 70 0 8 8 12 14 8 8-6 10-18 10-30 0 12 2 24 10 30 6 4 14 0 14-8 0-24-20-40-20-70z"
        fill="#c01818"
      />
    </svg>
  );
}

function Landing() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "1.5rem",
        background: "#000",
        color: "#fff",
        fontFamily: "system-ui, sans-serif",
        textAlign: "center",
        padding: "2rem",
      }}
    >
      <Link
        to="/"
        style={{
          fontSize: "4rem",
          fontWeight: 800,
          letterSpacing: "0.1em",
          color: "#fff",
          textDecoration: "none",
        }}
      >
        G&amp;D
      </Link>
      <VenomMascot />
      <ThemeToggle />
    </main>
  );
}
