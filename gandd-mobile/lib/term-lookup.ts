// Inline "tap a key term -> quick web lookup" helper for chat answers.
//
// Two parts:
//  1. detectKeyTerms(): a cheap, client-only heuristic that picks the most
//     "searchable" phrases in a FINISHED answer so the Markdown renderer can
//     underline them. Favours precision over recall (a few solid proper/technical
//     nouns, not 30 noisy ones).
//  2. lookupTerm(): fires a focused, web-grounded blurb about ONE term via the
//     same chat backend. Real (paid) web request — only ever call on an explicit
//     tap, and cache the finished state so re-tapping is instant.
//
// Ported from the web app's src/lib/term-lookup.ts + the chat page's key-term
// detection so the two platforms underline and explain the same way.

import { streamChat, type WebSource } from "./chat-client";
import type { Profile } from "./auth";

const MAX_KEY_TERMS = 8;

const KEY_TERM_STOPWORDS = new Set([
  "the",
  "this",
  "that",
  "these",
  "those",
  "there",
  "then",
  "they",
  "their",
  "them",
  "here",
  "however",
  "therefore",
  "because",
  "although",
  "meanwhile",
  "overall",
  "finally",
  "first",
  "second",
  "third",
  "next",
  "note",
  "important",
  "example",
  "for",
  "and",
  "but",
  "with",
  "your",
  "you",
  "our",
  "when",
  "while",
  "what",
  "which",
  "where",
  "how",
  "why",
  "who",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);

/**
 * Pick the key terms worth offering a one-tap lookup for. Matches capitalized
 * word runs ("Multiple Sclerosis") and ALL-CAPS acronyms ("MRI", "COPD"), drops
 * sentence-opening grammar words and stopwords, ranks multi-word phrases and
 * acronyms first, and caps the count so an answer never lights up like a tree.
 */
export function detectKeyTerms(text: string): string[] {
  if (!text) return [];

  const cleaned = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/^\s{0,3}#{1,6}\s.*$/gm, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ");

  // Capitalized run (up to 4 words) OR a 2-5 char ALL-CAPS acronym.
  const re = /\b([A-Z][a-zA-Z]{1,}(?:\s+[A-Z][a-zA-Z]{1,}){0,3}|[A-Z]{2,5})\b/g;

  type Candidate = { term: string; count: number; multiword: boolean };
  const byKey = new Map<string, Candidate>();
  let match: RegExpExecArray | null;

  while ((match = re.exec(cleaned)) !== null) {
    const term = match[1].trim();
    const words = term.split(/\s+/);
    const multiword = words.length > 1;
    const isAcronym = /^[A-Z]{2,5}$/.test(term);

    if (!multiword && !isAcronym) {
      const preceding = cleaned.slice(0, match.index).trimEnd();
      const atSentenceStart = preceding === "" || /[.!?:;]$/.test(preceding);
      if (atSentenceStart) continue;
      if (KEY_TERM_STOPWORDS.has(term.toLowerCase())) continue;
      if (term.length < 4) continue; // skip short one-off caps like "Dr" or initials
    }
    if (KEY_TERM_STOPWORDS.has(term.toLowerCase())) continue;

    const key = term.toLowerCase();
    const existing = byKey.get(key);
    if (existing) existing.count += 1;
    else byKey.set(key, { term, count: 1, multiword });
  }

  return Array.from(byKey.values())
    .sort((a, b) => {
      if (a.multiword !== b.multiword) return a.multiword ? -1 : 1;
      if (a.count !== b.count) return b.count - a.count;
      return b.term.length - a.term.length;
    })
    .slice(0, MAX_KEY_TERMS)
    .map((candidate) => candidate.term);
}

export type TermLookupState = {
  text: string;
  sources: WebSource[];
  loading: boolean;
  error?: string;
};

export function isTermLookupComplete(state: TermLookupState | undefined): boolean {
  return Boolean(state && !state.loading && !state.error);
}

/**
 * Kick off a focused, web-grounded lookup for `term`. Streams progress through
 * `onUpdate` (loading -> partial text/sources -> final). Pass a `signal` to
 * cancel when the popover closes or the user taps a different term.
 */
export function lookupTerm({
  term,
  profile,
  onUpdate,
  signal,
}: {
  term: string;
  profile: Profile;
  onUpdate: (state: TermLookupState) => void;
  signal?: AbortSignal;
}): void {
  let text = "";
  let sources: WebSource[] = [];

  // Immediate loading frame so the popover shows a spinner before the first byte.
  onUpdate({ text, sources, loading: true });

  void streamChat({
    messages: [
      {
        role: "user",
        content: `In 1-2 sentences, what is "${term}"? Key facts only, plain language. If it is a medical or technical term, say what it is and why it matters.`,
      },
    ],
    profile,
    // Simplified keeps the tone short; the term popover is a glance, not an essay.
    mode: "Simplified",
    documentMode: "none",
    forceWebSearch: true,
    onDelta: (chunk) => {
      text += chunk;
      onUpdate({ text, sources, loading: true });
    },
    onSources: (incoming) => {
      sources = incoming;
      onUpdate({ text, sources, loading: true });
    },
    onDone: () => onUpdate({ text, sources, loading: false }),
    onError: (error) => onUpdate({ text, sources, loading: false, error }),
    signal,
  });
}
