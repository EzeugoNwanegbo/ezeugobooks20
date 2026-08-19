import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

// One of three friends routes (see app.friends.tsx) — this one is search plus
// incoming/outgoing requests. Exists whether or not the social schema is
// applied; the gate lives in -app.friends-shared.tsx's FriendsPageFrame.
const FriendsAddPage = lazy(() =>
  import("./-app.friends-add-page").then((module) => ({ default: module.FriendsAddPage })),
);

export const Route = createFileRoute("/app/friends-add")({
  head: () => ({ meta: [{ title: "Add friends - G&D" }] }),
  component: FriendsAddRoute,
});

function FriendsAddRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FriendsAddPage />
    </Suspense>
  );
}
