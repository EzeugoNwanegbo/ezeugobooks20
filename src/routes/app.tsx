import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AppShellSkeleton } from "@/components/app-skeletons";

const AppShell = lazy(() =>
  import("./-app-shell").then((module) => ({ default: module.AppShell })),
);

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return (
    <Suspense fallback={<AppShellSkeleton />}>
      <AppShell />
    </Suspense>
  );
}
