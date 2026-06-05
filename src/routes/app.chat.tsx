import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { ChatSkeleton } from "@/components/app-skeletons";

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
    <Suspense fallback={<ChatSkeleton />}>
      <ChatPage />
    </Suspense>
  );
}
