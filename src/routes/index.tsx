import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  FileText,
  Layers,
  MessageSquare,
  Plus,
  Search,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { isNativeApp } from "@/lib/native";
import { signInWithGoogleNative } from "@/lib/native-auth";
import "@/components/landing-page.css";
import { EntranceMemes } from "@/components/entrance-memes";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "G&D — less searching, more clarity" },
      {
        name: "description",
        content:
          "Bring your textbooks, notes and slides together. Ask questions grounded in your material, build study roadmaps and practise what you learn with G&D.",
      },
    ],
  }),
  component: Landing,
});

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";

function NavAction() {
  const { user } = useAuth();
  return user ? (
    <Link to="/app/chat" className="gd-home-button gd-home-button-small">
      Open workspace <ArrowRight size={15} aria-hidden="true" />
    </Link>
  ) : (
    <Link to="/auth" search={{ mode: "signin" }} className="gd-home-nav-signin">
      Sign in <ArrowRight size={15} aria-hidden="true" />
    </Link>
  );
}

function AuthCard() {
  const { user } = useAuth();
  const [googleBusy, setGoogleBusy] = useState(false);

  const handleGoogle = async () => {
    if (googleBusy) return;
    setGoogleBusy(true);
    try {
      if (isNativeApp()) {
        // Embedded webviews must use the system browser and native deep link.
        await signInWithGoogleNative();
        setGoogleBusy(false);
        return;
      }
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}/auth` },
      });
      if (error) throw error;
      // Restore the button if a blocked or interrupted redirect leaves us here.
      window.setTimeout(() => {
        setGoogleBusy(false);
        toast.error("Google sign-in did not open. Check your connection and try again.");
      }, 6000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Google sign-in failed");
      setGoogleBusy(false);
    }
  };

  if (user) {
    return (
      <div className="gd-home-auth">
        <Link to="/app/chat" className="gd-home-button gd-home-button-block">
          Back to your workspace <ArrowRight size={18} aria-hidden="true" />
        </Link>
        <p className="gd-home-auth-note">Your next good study session starts here.</p>
      </div>
    );
  }

  return (
    <div className="gd-home-auth">
      <button
        type="button"
        className="gd-home-button gd-home-google"
        onClick={handleGoogle}
        disabled={googleBusy}
        aria-busy={googleBusy}
      >
        {googleBusy ? <span className="gd-home-spinner" aria-hidden="true" /> : <GoogleMark />}
        {googleBusy ? "Opening Google…" : "Get started with Google"}
        {!googleBusy && <ArrowRight size={17} aria-hidden="true" />}
      </button>
      <Link to="/auth" search={{ mode: "signup" }} className="gd-home-email">
        Prefer email?{" "}
        <span>
          Start here <ArrowRight size={13} aria-hidden="true" />
        </span>
      </Link>
      <p className="gd-home-auth-note">
        By continuing, you agree to our <Link to="/privacy">Privacy Policy</Link>.
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

type PreviewSubject = "medicine" | "law";

const PREVIEW_EXAMPLES = {
  medicine: {
    label: "Medicine",
    folder: "Human physiology",
    file: "Cardiovascular physiology.pdf",
    question: "Why does the heart beat faster during exercise?",
    answer:
      "During exercise, your muscles need more oxygen. The heart responds by pumping more blood each minute.",
    points: [
      ["Heart rate rises", "Sympathetic activity makes the heart beat faster."],
      ["More blood reaches muscles", "Cardiac output increases to meet the extra demand."],
    ],
    source: "Cardiovascular physiology · Exercise response",
  },
  law: {
    label: "Law",
    folder: "Contract law",
    file: "Foundations of contract law.pdf",
    question: "What is the difference between an offer and an invitation to treat?",
    answer:
      "An offer shows a clear willingness to be bound when accepted. An invitation to treat invites someone else to make an offer.",
    points: [
      ["An offer can be accepted", "Acceptance may create a binding agreement."],
      ["An invitation starts negotiation", "A shop display is a common example."],
    ],
    source: "Foundations of contract law · Agreement",
  },
} satisfies Record<
  PreviewSubject,
  {
    label: string;
    folder: string;
    file: string;
    question: string;
    answer: string;
    points: string[][];
    source: string;
  }
>;

function WorkspacePreview() {
  const [subject, setSubject] = useState<PreviewSubject>("medicine");
  const example = PREVIEW_EXAMPLES[subject];

  return (
    <div className="gd-home-preview-wrap" id="workspace-preview">
      <div className="gd-home-preview-label">
        <span className="gd-home-status-dot" aria-hidden="true" />A LOOK INSIDE YOUR WORKSPACE
      </div>
      <div className="gd-home-preview">
        <div className="gd-home-preview-topbar">
          <span className="gd-home-preview-brand">
            G&amp;D<span> / workspace</span>
          </span>
          <span className="gd-home-preview-avatar" aria-hidden="true">
            S
          </span>
        </div>
        <div className="gd-home-preview-body">
          <div className="gd-home-preview-rail" aria-hidden="true">
            <span className="gd-home-rail-item is-active">
              <MessageSquare size={17} />
            </span>
            <span className="gd-home-rail-item">
              <BookOpen size={17} />
            </span>
            <span className="gd-home-rail-item">
              <Layers size={17} />
            </span>
            <span className="gd-home-rail-plus">
              <Plus size={17} />
            </span>
          </div>
          <div className="gd-home-preview-content">
            <div className="gd-home-preview-breadcrumb">
              Library <ChevronRight size={11} aria-hidden="true" /> <span>{example.folder}</span>
            </div>
            <div className="gd-home-preview-heading">
              <h2>Find your “oh, I get it.”</h2>
              <p>Ask a question. Connect the dots.</p>
            </div>
            <div className="gd-home-subjects" role="group" aria-label="Choose a study preview">
              {(Object.keys(PREVIEW_EXAMPLES) as PreviewSubject[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={subject === key}
                  onClick={() => setSubject(key)}
                >
                  {PREVIEW_EXAMPLES[key].label}
                </button>
              ))}
            </div>
            <div className="gd-home-example" aria-live="polite" aria-atomic="true">
              <div className="gd-home-preview-file">
                <FileText size={14} aria-hidden="true" />
                <span>{example.file}</span>
                <Check size={13} aria-hidden="true" />
              </div>
              <div className="gd-home-preview-question">{example.question}</div>
              <div className="gd-home-preview-answer">
                <span className="gd-home-answer-mark" aria-hidden="true">
                  G&amp;D
                </span>
                <div>
                  <p>{example.answer}</p>
                  <ul>
                    {example.points.map(([title, detail]) => (
                      <li key={title}>
                        <strong>{title}</strong>
                        <span>{detail}</span>
                      </li>
                    ))}
                  </ul>
                  <div className="gd-home-preview-source">
                    <BookOpen size={12} aria-hidden="true" /> {example.source}
                  </div>
                </div>
              </div>
            </div>
            <div className="gd-home-preview-composer" aria-hidden="true">
              <Plus size={15} /> <span>Your next question…</span>{" "}
              <span className="gd-home-send">
                <ArrowRight size={15} />
              </span>
            </div>
            <p className="gd-home-preview-disclaimer">
              Interactive preview · example material and answer
            </p>
          </div>
        </div>
      </div>
      <div className="gd-home-preview-footnote">
        <span aria-hidden="true">↳</span> A question away from making it click.
      </div>
    </div>
  );
}

const FEATURES = [
  {
    number: "01",
    icon: BookOpen,
    title: "A home for your material.",
    description:
      "Keep textbooks, lecture slides and notes together in a library that makes sense to you.",
    detail: "YOUR LIBRARY, ORGANISED",
  },
  {
    number: "02",
    icon: MessageSquare,
    title: "Go straight to the question.",
    description:
      "Ask in your own words. Explore explanations grounded in the files you choose, then follow up until it clicks.",
    detail: "CONVERSATIONS WITH CONTEXT",
  },
  {
    number: "03",
    icon: Layers,
    title: "Turn clarity into confidence.",
    description:
      "Build a study roadmap, practise with questions and flashcards, and see what needs another look.",
    detail: "LEARN. PRACTISE. REPEAT.",
  },
];

function Landing() {
  const { user } = useAuth();
  return (
    <div className="gd-home">
      <link rel="stylesheet" href={FONTS_HREF} />
      <a href="#main-content" className="gd-home-skip">
        Skip to content
      </a>
      <header className="gd-home-nav gd-home-container">
        <Link to="/" className="gd-home-logo" aria-label="G and D home">
          G&amp;D
          <Sparkles size={18} strokeWidth={1.6} aria-hidden="true" />
        </Link>
        <nav className="gd-home-nav-links" aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#workspace-preview">The workspace</a>
        </nav>
        <NavAction />
      </header>

      <main id="main-content">
        <section className="gd-home-hero gd-home-container" aria-labelledby="hero-heading">
          <div className="gd-home-hero-copy">
            <p className="gd-home-eyebrow">
              <span className="gd-home-eyebrow-rule" /> MADE FOR THE WAY YOU STUDY
            </p>
            <h1 id="hero-heading">
              Less searching.
              <br />
              <span>More clarity.</span>
            </h1>
            <p className="gd-home-intro">
              Big textbooks. Full lecture folders. That one idea you just can't get your head
              around.
            </p>
            <p className="gd-home-description">
              Bring your material together. Ask better questions. Make understanding your next
              habit.
            </p>
            <AuthCard />
            <a className="gd-home-discover" href="#how-it-works">
              <ArrowDown size={14} aria-hidden="true" /> A better way to work through it
            </a>
          </div>
          <EntranceMemes />
        </section>

        <div className="gd-home-materials gd-home-container">
          <p>
            YOUR MATERIAL. <span>ALL IN ONE PLACE.</span>
          </p>
          <div>
            <span>
              <FileText size={15} aria-hidden="true" /> PDFs & textbooks
            </span>
            <span>
              <Layers size={15} aria-hidden="true" /> Lecture slides
            </span>
            <span>
              <BookOpen size={15} aria-hidden="true" /> Notes & documents
            </span>
          </div>
        </div>

        <section
          id="how-it-works"
          className="gd-home-features gd-home-container"
          aria-labelledby="features-heading"
        >
          <div className="gd-home-section-heading">
            <p className="gd-home-eyebrow">LESS FRICTION. MORE FOCUS.</p>
            <h2 id="features-heading">
              A good study session.
              <br />
              <span>From start to finish.</span>
            </h2>
            <p>
              One connected workspace for the material you have and the understanding you’re working
              towards.
            </p>
          </div>
          <div className="gd-home-feature-grid">
            {FEATURES.map(({ number, icon: Icon, title, description, detail }) => (
              <article key={number} className="gd-home-feature">
                <div className="gd-home-feature-top">
                  <span>{number}</span>
                  <Icon size={22} strokeWidth={1.4} aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
                <span className="gd-home-feature-detail">{detail}</span>
              </article>
            ))}
          </div>
        </section>

        <section
          className="gd-home-showcase gd-home-container"
          aria-label="Explore the G and D workspace"
        >
          <div className="gd-home-section-heading">
            <p className="gd-home-eyebrow">FROM STUDY MOOD TO STUDY FLOW</p>
            <h2>
              Your next “I get it.”
              <br />
              <span>See how it starts.</span>
            </h2>
            <p>Choose a subject and explore how a question becomes a clearer understanding.</p>
          </div>
          <WorkspacePreview />
        </section>

        <section className="gd-home-workflow gd-home-container" aria-labelledby="workflow-heading">
          <div className="gd-home-workflow-art" aria-hidden="true">
            <div className="gd-home-workflow-orbit" />
            <div className="gd-home-workflow-node gd-home-workflow-node-book">
              <BookOpen size={24} strokeWidth={1.5} />
              <span>Your material</span>
            </div>
            <div className="gd-home-workflow-center">
              <span>G&amp;D</span>
            </div>
            <div className="gd-home-workflow-node gd-home-workflow-node-search">
              <Search size={21} strokeWidth={1.5} />
              <span>Your questions</span>
            </div>
            <div className="gd-home-workflow-node gd-home-workflow-node-clarity">
              <Sparkles size={20} strokeWidth={1.5} />
              <span>Your understanding</span>
            </div>
            <span className="gd-home-workflow-caption">CONNECT THE DOTS.</span>
          </div>
          <div className="gd-home-workflow-copy">
            <p className="gd-home-eyebrow">YOUR LEARNING, CONNECTED</p>
            <h2 id="workflow-heading">
              Stay with the thought.
              <br />
              <span>We’ll help with the rest.</span>
            </h2>
            <p>
              Move from a question to an explanation to practice, without losing your place. Your
              library and your learning belong together.
            </p>
            <ol className="gd-home-workflow-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Bring what you’re studying</strong>
                  <p>Upload your files and organise them into folders.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Make the difficult bits clearer</strong>
                  <p>Choose your material and ask what’s on your mind.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Put your understanding to work</strong>
                  <p>Make a roadmap and practise the topics that matter.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="gd-home-final gd-home-container" aria-labelledby="final-heading">
          <p className="gd-home-eyebrow">YOUR NEXT “I GET IT” STARTS HERE.</p>
          <h2 id="final-heading">
            Make room for
            <br />
            <span>better understanding.</span>
          </h2>
          <Link
            to={user ? "/app/chat" : "/auth"}
            search={user ? undefined : { mode: "signup" }}
            className="gd-home-button"
          >
            {user ? "Open your workspace" : "Start your workspace"}{" "}
            <ArrowRight size={18} aria-hidden="true" />
          </Link>
          <p>Your textbooks. Your questions. Your way forward.</p>
        </section>
      </main>

      <footer className="gd-home-footer gd-home-container">
        <div className="gd-home-footer-top">
          <Link to="/" className="gd-home-logo" aria-label="G and D home">
            G&amp;D
          </Link>
          <p>A little clarity goes a long way.</p>
          <Link to="/privacy">
            Privacy Policy <ArrowRight size={13} aria-hidden="true" />
          </Link>
        </div>
        <div className="gd-home-footer-bottom">
          <span>© {new Date().getFullYear()} G&amp;D</span>
          <span>BUILT FOR CURIOUS MINDS.</span>
        </div>
      </footer>
    </div>
  );
}
