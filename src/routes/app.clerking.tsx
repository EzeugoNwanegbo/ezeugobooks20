import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
const Page = lazy(() => import("./-app.clerking-page").then((m) => ({ default: m.ClerkingPage })));
export const Route = createFileRoute("/app/clerking")({
  head: () => ({ meta: [{ title: "Patient clerking — G&D" }] }),
  component: () => (
    <Suspense fallback={<p className="p-8">Loading patient clerking…</p>}>
      <Page />
    </Suspense>
  ),
});
