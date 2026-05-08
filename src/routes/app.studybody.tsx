import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

const StudyBodyPage = lazy(() =>
  import("./-app.studybody-page").then((module) => ({ default: module.StudyBodyPage })),
);

export const Route = createFileRoute("/app/studybody")({
  head: () => ({ meta: [{ title: "StudyBody - G&D" }] }),
  component: StudyBodyRoute,
});

function StudyBodyRoute() {
  return (
    <Suspense fallback={<Loader2 className="m-auto h-5 w-5 animate-spin text-primary" />}>
      <StudyBodyPage />
    </Suspense>
  );
}
