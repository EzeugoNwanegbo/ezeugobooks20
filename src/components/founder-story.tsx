import { useState } from "react";
import { ChevronDown } from "lucide-react";

// The founder's story - shown beneath the auth panel and the onboarding
// questions. Collapsed by default so it never pushes the form below the fold;
// expanding is a deliberate act by readers who want the "why".
export function FounderStory({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <section className={`luxury-panel rounded-lg shadow-elegant backdrop-blur ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 p-5 text-left sm:px-6"
      >
        <span>
          <span className="block text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
            Why G&amp;D exists
          </span>
          <span className="mt-1 block font-display text-lg font-light leading-snug sm:text-xl">
            The day I nearly failed my viva
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && (
        <div className="space-y-3.5 px-5 pb-6 text-sm leading-relaxed text-muted-foreground sm:px-6">
          <p>
            I still remember walking into my physiology viva. Heart racing. The lecturer fired
            off questions, and one after another, I fumbled.
          </p>
          <p>
            Then he asked something that sounded simple: <em className="text-foreground">"Define accommodation."</em>
          </p>
          <p>
            I answered confidently - and I was wrong. I'd described <em>acclimatization</em>{" "}
            instead. He shook his head. "That's wrong."
          </p>
          <p>
            I thought it was over. Then he gave me one last chance:{" "}
            <em className="text-foreground">
              "Leave the hall, find the answer, and come back in five minutes."
            </em>
          </p>
          <p className="font-medium text-foreground">Five minutes. That was all I had.</p>
          <p>
            I rushed out and opened my copy of <em>Essential Physiology</em> - over 1,300 pages.
            I flipped, scrolled, searched, panicked. Every second felt like a minute. I knew
            that if I walked back in without the answer, I'd fail.
          </p>
          <p>
            I even tried an AI chatbot. But because I was already confusing the two terms, it
            kept confidently explaining the wrong concept. It couldn't point me to the exact
            passage in my textbook - the one thing I actually needed. The clock kept ticking.
          </p>
          <p>
            Then a lecturer passing by saw me struggling, asked what was wrong, and pointed me
            to the right section in seconds. Relief. I rushed back in and gave the correct
            answer.
          </p>
          <p>
            But walking home that day, one thought wouldn't leave me: what if he hadn't been
            there? What about the thousands of students facing this every day - carrying
            massive textbooks, losing marks not because they didn't have the information, but
            because they couldn't find it fast enough?
          </p>
          <p>
            That's why I built G&amp;D. An AI that reads your actual textbooks - all 1,300
            pages - and finds the exact page, diagram, or explanation in seconds. Not a chatbot
            guessing from memory, but answers pulled straight from your material, with the
            source shown so you can trust it.
          </p>
          <p>
            No student should have to choose between burning precious exam minutes searching,
            or walking back into that room unprepared.
          </p>
          <p className="font-medium text-foreground">That promise became G&amp;D.</p>
        </div>
      )}
    </section>
  );
}
