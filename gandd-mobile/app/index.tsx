import { Redirect } from "expo-router";
import { useAuth } from "@/lib/auth";
import { Splash } from "@/components/splash";

// Entry gate: routes to auth / onboarding / app based on session + profile.
export default function Index() {
  const { loading, user, profile } = useAuth();

  if (loading) return <Splash subtitle="Opening your workspace..." />;
  if (!user) return <Redirect href="/auth" />;
  // Signed in but profile still loading — hold on the splash.
  if (!profile) return <Splash subtitle="Loading your profile..." />;
  if (!profile.onboarded) return <Redirect href="/onboarding" />;
  return <Redirect href="/(app)/chat" />;
}
