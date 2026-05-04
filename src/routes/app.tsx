import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

const AppShell = lazy(() =>
  import("./-app-shell").then((module) => ({ default: module.AppShell })),
);

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return (
    <Suspense fallback={<Loader2 className="m-auto h-5 w-5 animate-spin text-primary" />}>
      <AppShell />
    </Suspense>
  );
}
