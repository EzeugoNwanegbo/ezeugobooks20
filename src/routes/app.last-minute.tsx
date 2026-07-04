import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const LastMinutePage = lazy(() =>
  import("./-app.last-minute-page").then((module) => ({ default: module.LastMinutePage })),
);

export const Route = createFileRoute("/app/last-minute")({
  head: () => ({ meta: [{ title: "Last Minute - G&D" }] }),
  component: LastMinuteRoute,
});

function LastMinuteRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LastMinutePage />
    </Suspense>
  );
}
