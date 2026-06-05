import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const HistoryPage = lazy(() =>
  import("./-app.history-page").then((module) => ({ default: module.HistoryPage })),
);

export const Route = createFileRoute("/app/history")({
  head: () => ({ meta: [{ title: "History - G&D" }] }),
  component: HistoryRoute,
});

function HistoryRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <HistoryPage />
    </Suspense>
  );
}
