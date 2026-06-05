import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const SettingsPage = lazy(() =>
  import("./-app.settings-page").then((module) => ({ default: module.SettingsPage })),
);

export const Route = createFileRoute("/app/settings")({
  head: () => ({ meta: [{ title: "Settings - G&D" }] }),
  component: SettingsRoute,
});

function SettingsRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SettingsPage />
    </Suspense>
  );
}
