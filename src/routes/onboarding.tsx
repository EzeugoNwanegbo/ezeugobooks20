import { createFileRoute } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { lazy, Suspense } from "react";

const OnboardingPage = lazy(() =>
  import("./-onboarding-page").then((module) => ({ default: module.OnboardingPage })),
);

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [{ title: "Set up your profile - G&D" }],
  }),
  component: OnboardingRoute,
});

function OnboardingRoute() {
  return (
    <Suspense fallback={<Loader2 className="m-auto h-5 w-5 animate-spin text-primary" />}>
      <OnboardingPage />
    </Suspense>
  );
}
