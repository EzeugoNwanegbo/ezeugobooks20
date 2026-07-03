import { Copy, Heart, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

// Feedback is delivered by opening the user's email app (mailto) - no backend
// or database table required. The address is also shown and copyable so people
// can still reach us if their device has no mail app configured.
const CONTACT_EMAIL = "nwanegboezeugo@gmail.com";

const TYPES = ["Feedback", "Idea", "Bug", "Contribute"] as const;
type FeedbackType = (typeof TYPES)[number];

export function FeedbackPage() {
  const [type, setType] = useState<FeedbackType>("Feedback");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const send = () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Please write a message first");
      return;
    }
    const who = name.trim() ? ` from ${name.trim()}` : "";
    const subject = `G&D ${type}${who}`;
    const body = `${trimmed}\n\n- Sent from G&D`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(CONTACT_EMAIL);
      toast.success("Email address copied");
    } catch {
      toast.error(`Could not copy - email us at ${CONTACT_EMAIL}`);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-x-hidden">
        <header>
          <div className="flex items-center gap-2 text-sm font-medium text-primary">
            <Heart className="h-4 w-4" />
            Feedback &amp; Contribute
          </div>
          <h1 className="font-display text-2xl font-light tracking-normal sm:text-3xl md:text-4xl">
            Help us make G&amp;D better.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Share an idea, report a bug, or tell us how you&apos;d like to contribute. Your message
            opens in your email app and comes straight to us.
          </p>
        </header>

        <div className="luxury-panel rounded-lg p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {TYPES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  type === option
                    ? "border-primary/30 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-surface-elevated hover:text-foreground"
                }`}
              >
                {option}
              </button>
            ))}
          </div>

          <label className="mt-4 block text-sm font-medium" htmlFor="feedback-name">
            Your name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            id="feedback-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="So we know who to thank"
            className="mt-1.5 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          <label className="mt-4 block text-sm font-medium" htmlFor="feedback-message">
            Message
          </label>
          <textarea
            id="feedback-message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What's on your mind?"
            className="mt-1.5 min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          <button
            type="button"
            onClick={send}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            Send message
          </button>

          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm">
            <span className="truncate text-muted-foreground">
              Or email us directly: <span className="text-foreground">{CONTACT_EMAIL}</span>
            </span>
            <button
              type="button"
              onClick={copyEmail}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground"
              title="Copy email address"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
