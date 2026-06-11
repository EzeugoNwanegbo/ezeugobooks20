import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Redirect } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { signInWithGoogleNative } from "@/lib/native-auth";
import { BrandText, Button, Card, Field } from "@/components/ui";
import { Splash } from "@/components/splash";
import { toast } from "@/components/toast";
import { colors, radius } from "@/lib/theme";

const EMAIL_CONFIRM_NOTICE =
  "Account created. A confirmation email has been sent. Please confirm your email, then come back here to sign in.";

export default function AuthScreen() {
  const insets = useSafeAreaInsets();
  const { user, profile, loading } = useAuth();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);

  // Already signed in — bounce out of the auth screen.
  if (user && !loading) {
    if (!profile) return <Splash subtitle="Loading your profile..." />;
    return <Redirect href={profile.onboarded ? "/(app)/chat" : "/onboarding"} />;
  }

  const handleEmail = async () => {
    if (submitting) return;
    if (!email.trim() || password.length < 6) {
      toast.error("Enter your email and a password of at least 6 characters.");
      return;
    }
    setSubmitting(true);
    setAuthNotice(null);
    try {
      const trimmedEmail = email.trim();
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Welcome to G&D!");
          // Auth listener will pick up the session and redirect.
        } else {
          setPassword("");
          setIsSignup(false);
          setAuthNotice(EMAIL_CONFIRM_NOTICE);
          toast.success("Check your email to confirm your account.");
          setSubmitting(false);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) throw error;
        toast.success("Welcome back!");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Authentication failed");
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    if (googleSubmitting) return;
    setGoogleSubmitting(true);
    setAuthNotice(null);
    try {
      await signInWithGoogleNative();
      // On success the auth listener establishes the session and redirects.
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      if (!message.toLowerCase().includes("cancel")) toast.error(message);
    } finally {
      setGoogleSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 32 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.brandRow}>
          <BrandText size={26} />
        </View>

        <Card style={styles.card}>
          <Text style={styles.title}>{isSignup ? "Create your account" : "Welcome back"}</Text>
          <Text style={styles.subtitle}>
            {isSignup
              ? "Join G&D and start studying smarter."
              : "Sign in to continue your studies."}
          </Text>

          {authNotice ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{authNotice}</Text>
            </View>
          ) : null}

          <Button
            label={
              googleSubmitting
                ? "Opening Google..."
                : isSignup
                  ? "Create account with Google"
                  : "Sign in with Google"
            }
            variant="secondary"
            loading={googleSubmitting}
            onPress={handleGoogle}
            icon={<Text style={styles.googleG}>G</Text>}
            style={{ marginTop: 22 }}
          />

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerText}>or use email</Text>
            <View style={styles.line} />
          </View>

          <View style={{ gap: 14 }}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
            />
            <View style={{ gap: 6 }}>
              <Text style={styles.fieldLabel}>Password</Text>
              <View style={styles.passwordRow}>
                <Field
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder="••••••••"
                  style={styles.passwordInput}
                />
                <Pressable
                  onPress={() => setShowPassword((v) => !v)}
                  style={styles.eyeButton}
                  hitSlop={8}
                >
                  {showPassword ? (
                    <EyeOff size={18} color={colors.muted} />
                  ) : (
                    <Eye size={18} color={colors.muted} />
                  )}
                </Pressable>
              </View>
            </View>

            <Button
              label={
                submitting
                  ? isSignup
                    ? "Creating..."
                    : "Signing in..."
                  : isSignup
                    ? "Create account"
                    : "Sign in"
              }
              loading={submitting}
              onPress={handleEmail}
              style={{ marginTop: 4 }}
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.switchText}>{isSignup ? "Already have an account?" : "New here?"}</Text>
            <Pressable
              onPress={() => {
                setAuthNotice(null);
                setIsSignup((v) => !v);
              }}
              hitSlop={8}
            >
              <Text style={styles.switchLink}>{isSignup ? "Sign in" : "Create one"}</Text>
            </Pressable>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
  },
  brandRow: {
    alignItems: "center",
    marginBottom: 20,
  },
  card: { gap: 0 },
  title: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "300",
  },
  subtitle: {
    color: colors.muted,
    fontSize: 14,
    marginTop: 6,
  },
  notice: {
    marginTop: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  noticeText: { color: colors.text, fontSize: 13 },
  googleG: { color: colors.text, fontSize: 17, fontWeight: "800" },
  divider: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginVertical: 18,
  },
  line: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { color: colors.mutedDim, fontSize: 12 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  passwordRow: { position: "relative", justifyContent: "center" },
  passwordInput: { paddingRight: 48 },
  eyeButton: {
    position: "absolute",
    right: 12,
    height: "100%",
    justifyContent: "center",
  },
  switchRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 6,
    marginTop: 20,
  },
  switchText: { color: colors.muted, fontSize: 13 },
  switchLink: { color: colors.accent, fontSize: 13, fontWeight: "700" },
});
