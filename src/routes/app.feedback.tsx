import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const FeedbackPage = lazy(() =>
  import("./-app.feedback-page").then((module) => ({ default: module.FeedbackPage })),
);

export const Route = createFileRoute("/app/feedback")({
  head: () => ({ meta: [{ title: "Feedback - G&D" }] }),
  component: FeedbackRoute,
});

function FeedbackRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FeedbackPage />
    </Suspense>
  );
}
