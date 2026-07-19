import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PageSkeleton } from "@/components/app-skeletons";

const AdminPage = lazy(() =>
  import("./-app.admin-page").then((module) => ({ default: module.AdminPage })),
);

export const Route = createFileRoute("/app/admin")({
  head: () => ({ meta: [{ title: "Admin - G&D" }] }),
  component: AdminRoute,
});

function AdminRoute() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AdminPage />
    </Suspense>
  );
}
