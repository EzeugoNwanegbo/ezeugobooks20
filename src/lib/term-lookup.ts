import { streamChat, type WebSource } from "@/lib/chat-client";
import type { Profile } from "@/lib/auth-context";

/**
 * Inline "tap a key term -> quick web lookup" helper.
 *
 * WHY a dedicated helper: the chat page already knows how to stream a full
 * conversation via `streamChat`, but the key-term popover wants something much
 * narrower — a single focused, web-grounded blurb about ONE term. Wrapping that
 * intent here keeps the Message component lean, gives us one obvious place to
 * shape the prompt, and lets callers cache the finished result per term (see
 * `TermLookupState`) so re-tapping a term is instant and free.
 *
 * COST/LATENCY: every call goes out with `forceWebSearch: true`, so it is a real
 * (paid, ~seconds) web request. Callers MUST only invoke this on an explicit tap
 * and MUST cache the completed state — never fire it automatically on render.
 */
export type TermLookupState = {
  /** Streamed explanation text so far (or final text once `loading` is false). */
  text: string;
  /** Web citations streamed by the chat backend, if any. */
  sources: WebSource[];
  /** True while the request is still streaming. */
  loading: boolean;
  /** Set if the lookup failed or was cancelled; `text` may still hold partials. */
  error?: string;
};

/** A finished lookup is one that is no longer loading and did not error out. */
export function isTermLookupComplete(state: TermLookupState | undefined): boolean {
  return Boolean(state && !state.loading && !state.error);
}

/**
 * Kick off a focused web lookup for `term`. Streams progress through `onUpdate`
 * (loading -> partial text/sources -> final). Fire-and-forget; pass a `signal`
 * to cancel when the popover closes or the user taps a different term.
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

  // Emit an immediate loading frame so the popover can show a spinner the moment
  // it opens, before the first network byte arrives.
  onUpdate({ text, sources, loading: true });

  void streamChat({
    messages: [
      {
        role: "user",
        // Tight prompt keeps the answer to a glanceable blurb and holds latency
        // down. "Key facts only" discourages the model from padding.
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
    onDone: () => {
      onUpdate({ text, sources, loading: false });
    },
    onError: (error) => {
      onUpdate({ text, sources, loading: false, error });
    },
    onCancel: () => {
      onUpdate({ text, sources, loading: false, error: "Lookup cancelled." });
    },
    signal,
  });
}
