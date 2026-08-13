import {
  HankenGrotesk_400Regular,
  HankenGrotesk_500Medium,
  HankenGrotesk_600SemiBold,
  HankenGrotesk_700Bold,
} from "@expo-google-fonts/hanken-grotesk";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Splash } from "@/components/splash";
import { ToastHost } from "@/components/toast";
import { AuthProvider } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function RootLayout() {
  // One workhorse face (Hanken Grotesk) for every job, mono for plate numerals
  // and source keys, and Varsity for the wordmark alone — the same three the
  // website loads. Varsity ships in the bundle rather than from Google.
  const [fontsLoaded] = useFonts({
    HankenGrotesk_400Regular,
    HankenGrotesk_500Medium,
    HankenGrotesk_600SemiBold,
    HankenGrotesk_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    Varsity: require("../assets/fonts/varsity_regular.ttf"),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <StatusBar style="light" backgroundColor={colors.bg} />
            {fontsLoaded ? (
              <Stack
                screenOptions={{
                  headerShown: false,
                  animation: "fade",
                  contentStyle: { backgroundColor: colors.bg },
                }}
              >
                <Stack.Screen name="index" />
                <Stack.Screen name="auth" />
                <Stack.Screen name="onboarding" />
                {/* Legal screens: reachable signed-out (Google Play requires this),
                    so they sit here rather than in (app), which redirects to /auth
                    without a session. */}
                <Stack.Screen name="privacy" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="delete-account" options={{ animation: "slide_from_right" }} />
                <Stack.Screen name="(app)" />
              </Stack>
            ) : (
              <Splash subtitle="Preparing your workspace..." />
            )}
            <ToastHost />
          </View>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
