import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

// One of three friends routes (see app.friends.tsx) — this one is open
// challenges, results and the overall record. Exists whether or not the
// social schema is applied; the gate lives in -app.friends-shared.tsx's
// FriendsPageFrame.
const FriendsBattlesPage = lazy(() =>
  import("./-app.friends-battles-page").then((module) => ({ default: module.FriendsBattlesPage })),
);

export const Route = createFileRoute("/app/friends-battles")({
  head: () => ({ meta: [{ title: "Battles - G&D" }] }),
  component: FriendsBattlesRoute,
});

function FriendsBattlesRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FriendsBattlesPage />
    </Suspense>
  );
}
