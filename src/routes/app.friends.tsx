import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

// The route exists whether or not the schema is applied — the page itself is
// gated (see src/lib/social.ts). A route that only exists behind a flag would
// break every deep link the moment the flag moved.
const FriendsPage = lazy(() =>
  import("./-app.friends-page").then((module) => ({ default: module.FriendsPage })),
);

export const Route = createFileRoute("/app/friends")({
  head: () => ({ meta: [{ title: "Friends - G&D" }] }),
  component: FriendsRoute,
});

function FriendsRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FriendsPage />
    </Suspense>
  );
}
