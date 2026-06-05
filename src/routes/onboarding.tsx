import { createFileRoute } from "@tanstack/react-router";
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
    <Suspense fallback={<div className="min-h-dvh bg-background" />}>
      <OnboardingPage />
    </Suspense>
  );
}
