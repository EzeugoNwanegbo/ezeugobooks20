import { Link } from "@tanstack/react-router";
import { BookOpen, Lightbulb, Network, ArrowUpRight } from "lucide-react";

/** Suggestions prepare a question; they never send a paid request. */
export function ChatStarters({
  hasFiles,
  onPrepare,
}: {
  hasFiles: boolean;
  onPrepare: (question: string, useFiles?: boolean) => void;
}) {
  return (
    <div className="gd-chat-starters" aria-label="Ways to start studying">
      <button
        type="button"
        onClick={() => onPrepare("Explain [topic] in simple terms, with one useful example.")}
      >
        <Lightbulb aria-hidden="true" />
        <span>
          <strong>Break it down</strong>
          <small>Make a difficult concept click.</small>
        </span>
        <ArrowUpRight className="gd-starter-arrow" aria-hidden="true" />
      </button>
      {hasFiles ? (
        <button
          type="button"
          onClick={() =>
            onPrepare(
              "What does my material say about [topic]? Quote the relevant section and explain it.",
              true,
            )
          }
        >
          <BookOpen aria-hidden="true" />
          <span>
            <strong>Go to the source</strong>
            <small>Find the answer in your material.</small>
          </span>
          <ArrowUpRight className="gd-starter-arrow" aria-hidden="true" />
        </button>
      ) : (
        <Link to="/app/library">
          <BookOpen aria-hidden="true" />
          <span>
            <strong>Add your material</strong>
            <small>Bring your textbooks and notes.</small>
          </span>
          <ArrowUpRight className="gd-starter-arrow" aria-hidden="true" />
        </Link>
      )}
      <button
        type="button"
        onClick={() =>
          onPrepare(
            "Compare [concept A] and [concept B]. Explain where they overlap and where they differ.",
          )
        }
      >
        <Network aria-hidden="true" />
        <span>
          <strong>Connect the ideas</strong>
          <small>See how two concepts fit together.</small>
        </span>
        <ArrowUpRight className="gd-starter-arrow" aria-hidden="true" />
      </button>
    </div>
  );
}
