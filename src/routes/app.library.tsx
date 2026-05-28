import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

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
    <Suspense fallback={<Loader2 className="m-auto h-5 w-5 animate-spin text-primary" />}>
      <LibraryPage />
    </Suspense>
  );
}
