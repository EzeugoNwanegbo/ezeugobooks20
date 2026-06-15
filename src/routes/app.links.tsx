import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const LinksPage = lazy(() =>
  import("./-app.links-page").then((module) => ({ default: module.LinksPage })),
);

export const Route = createFileRoute("/app/links")({
  head: () => ({ meta: [{ title: "Links - G&D" }] }),
  component: LinksRoute,
});

function LinksRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LinksPage />
    </Suspense>
  );
}
