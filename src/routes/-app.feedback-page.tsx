import { Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/ui/page-header";

// Feedback is delivered by opening the user's email app (mailto) - no backend
// or database table required.
//
// mailto: is a one-way throw. A browser with no mail-client handler does
// nothing at all, and the page cannot detect that, so a student on a phone
// with no mail app configured would press Send and watch nothing happen. The
// recovery lives in the toast rather than on the page: the address and a copy
// action appear only after Send, so the screen itself stays a box and a button.
const CONTACT_EMAIL = "nwanegboezeugo@gmail.com";

export function FeedbackPage() {
  const [message, setMessage] = useState("");

  const send = () => {
    const trimmed = message.trim();
    if (!trimmed) {
      toast.error("Write a message first");
      return;
    }
    const subject = "G&D Feedback";
    const body = `${trimmed}\n\n- Sent from G&D`;
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`;

    toast("Opening your email app", {
      description: `If nothing opens, send it to ${CONTACT_EMAIL}`,
      action: {
        label: "Copy",
        onClick: () => {
          void navigator.clipboard
            ?.writeText(`${CONTACT_EMAIL}\n\n${trimmed}`)
            .then(() => toast.success("Copied"))
            .catch(() => toast.error("Could not copy - the address is above"));
        },
      },
      duration: 10000,
    });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 overflow-x-hidden">
        <PageHeader eyebrow="G&D" title="Feedback" />

        <div className="luxury-panel rounded-lg p-4 sm:p-5">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What's on your mind?"
            autoFocus
            className="min-h-48 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />

          <button
            type="button"
            onClick={send}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
