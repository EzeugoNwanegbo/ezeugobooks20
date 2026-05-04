import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

type ChatSearch = { c?: string };

const ChatPage = lazy(() =>
  import("./-app.chat-page").then((module) => ({ default: module.ChatPage })),
);

export const Route = createFileRoute("/app/chat")({
  head: () => ({ meta: [{ title: "Chat - G&D" }] }),
  validateSearch: (s: Record<string, unknown>): ChatSearch => ({
    c: typeof s.c === "string" ? s.c : undefined,
  }),
  component: ChatRoute,
});

function ChatRoute() {
  return (
    <Suspense fallback={<Loader2 className="m-auto h-5 w-5 animate-spin text-primary" />}>
      <ChatPage />
    </Suspense>
  );
}
