import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const StudyBodyPage = lazy(() =>
  import("./-app.studybody-page").then((module) => ({ default: module.StudyBodyPage })),
);

export const Route = createFileRoute("/app/studybody")({
  head: () => ({ meta: [{ title: "Practice Questions - G&D" }] }),
  component: StudyBodyRoute,
});

function StudyBodyRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StudyBodyPage />
    </Suspense>
  );
}
