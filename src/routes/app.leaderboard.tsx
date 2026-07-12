import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const LeaderboardPage = lazy(() =>
  import("./-app.leaderboard-page").then((module) => ({ default: module.LeaderboardPage })),
);

export const Route = createFileRoute("/app/leaderboard")({
  head: () => ({ meta: [{ title: "Leaderboard - G&D" }] }),
  component: LeaderboardRoute,
});

function LeaderboardRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <LeaderboardPage />
    </Suspense>
  );
}
