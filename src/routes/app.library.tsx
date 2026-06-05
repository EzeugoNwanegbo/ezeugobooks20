import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const LibraryPage = lazy(() =>
  import("./-app.library-page").then((module) => ({ default: module.LibraryPage })),
);

export const Route = createFileRoute("/app/library")({
  validateSearch: (search: Record<string, unknown>): { onboarding?: boolean } => ({
    onboarding: search.onboarding === true || search.onboarding === "true",
  }),
  head: () => ({ meta: [{ title: "Library - G&D" }] }),
  component: LibraryRoute,
});

function LibraryRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LibraryPage />
    </Suspense>
  );
}
