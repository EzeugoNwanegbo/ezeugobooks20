import { Redirect, Stack } from "expo-router";
import { View } from "react-native";
import { Splash } from "@/components/splash";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";
import {
  BottomNav,
  ConversationProvider,
  Drawer,
  DrawerProvider,
  ModalProvider,
  useBackNavigation,
} from "@/platform";

export default function AppLayout() {
  const { loading, user, profile } = useAuth();

  if (loading) return <Splash subtitle="Opening your workspace..." />;
  if (!user) return <Redirect href="/auth" />;
  if (!profile) return <Splash subtitle="Loading your profile..." />;
  if (!profile.onboarded) return <Redirect href="/onboarding" />;

  return (
    <DrawerProvider>
      <ModalProvider>
        <ConversationProvider>
          <AppShell />
        </ConversationProvider>
      </ModalProvider>
    </DrawerProvider>
  );
}

// Separated so the hardware-back hook runs inside the Drawer/Modal providers.
function AppShell() {
  useBackNavigation();

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: "fade",
          animationDuration: 160,
        }}
      >
        {/* Main tabs — MainTabContainer owns the directional slide, so the stack
            itself does no transition (avoids a fade fighting the slide). */}
        <Stack.Screen name="chat" options={{ animation: "none" }} />
        <Stack.Screen name="library" options={{ animation: "none" }} />
        <Stack.Screen name="last-minute" options={{ animation: "none" }} />
        <Stack.Screen name="coach" options={{ animation: "none" }} />
        {/* Secondary (drawer) screens — slide in, swipe-back to return. */}
        <Stack.Screen name="links" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="history" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="settings" options={{ animation: "slide_from_right" }} />
        <Stack.Screen name="feedback" options={{ animation: "slide_from_right" }} />
        {/* Legacy route kept so old links don't 404; redirects to coach. */}
        <Stack.Screen name="studybody" options={{ animation: "fade" }} />
      </Stack>

      <BottomNav />
      <Drawer />
    </View>
  );
}
