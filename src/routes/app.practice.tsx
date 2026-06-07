import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

type PracticeSearch = { plan?: string; session?: string; mode?: "learning" | "exam" };

const PracticePage = lazy(() =>
  import("./-app.practice-page").then((module) => ({ default: module.PracticePage })),
);

export const Route = createFileRoute("/app/practice")({
  head: () => ({ meta: [{ title: "Practice - My Coach" }] }),
  validateSearch: (s: Record<string, unknown>): PracticeSearch => ({
    plan: typeof s.plan === "string" ? s.plan : undefined,
    session: typeof s.session === "string" ? s.session : undefined,
    mode: s.mode === "exam" ? "exam" : s.mode === "learning" ? "learning" : undefined,
  }),
  component: PracticeRoute,
});

function PracticeRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PracticePage />
    </Suspense>
  );
}
