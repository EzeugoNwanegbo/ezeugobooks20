import { useEffect, useState } from "react";
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
import { Redirect, useRouter } from "expo-router";
import { ArrowLeft, ArrowRight } from "lucide-react-native";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { BrandText, Button, Card, Field } from "@/components/ui";
import { Splash } from "@/components/splash";
import { toast } from "@/components/toast";
import { colors, radius } from "@/lib/theme";
import { useKeyboardHeight } from "@/platform";

const STEPS = ["About you", "Your studies", "Your exams", "Your style"] as const;
const YEARS = ["Year 1", "Year 2", "Year 3", "Year 4", "Year 5", "Other"];
const EXAM_FORMATS: { value: "MCQ" | "SAQ" | "OSCE" | "Viva"; label: string }[] = [
  { value: "MCQ", label: "Quiz" },
  { value: "SAQ", label: "Short answer" },
  { value: "OSCE", label: "Practical" },
  { value: "Viva", label: "Oral" },
];
const MODES: { v: "Simplified" | "Detailed"; title: string; body: string }[] = [
  { v: "Simplified", title: "Simplified", body: "Plain English, real-world analogies, short answers." },
  { v: "Detailed", title: "Detailed", body: "Deeper reasoning, key details, examples, and exam points." },
];

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, profile, loading, refreshProfile } = useAuth();
  // KeyboardAvoidingView's "padding" behavior only does anything on iOS
  // (behavior is undefined on Android below) — this app runs edge-to-edge on
  // Android, where the window doesn't resize for the keyboard, so the field
  // on step 0 (autoFocus) and the Continue button need a manual scroll
  // allowance or the keyboard just sits on top of them.
  const keyboardHeight = useKeyboardHeight();

  const [started, setStarted] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [university, setUniversity] = useState("");
  const [year, setYear] = useState("Year 1");
  const [examFormat, setExamFormat] = useState<"MCQ" | "SAQ" | "OSCE" | "Viva">("MCQ");
  const [mode, setMode] = useState<"Simplified" | "Detailed">("Simplified");

  useEffect(() => {
    if (profile?.name && !name) setName(profile.name);
  }, [profile, name]);

  if (loading) return <Splash subtitle="Preparing your setup..." />;
  if (!user) return <Redirect href="/auth" />;
  if (profile?.onboarded) return <Redirect href="/(app)/chat" />;

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const prev = () => setStep((s) => Math.max(s - 1, 0));

  const finish = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("user_profiles").upsert({
        id: user.id,
        name,
        university,
        year,
        exam_format: examFormat,
        preferred_mode: mode,
        onboarded: true,
      });
      if (error) throw error;
      await refreshProfile();
      toast.success("You're all set!");
      router.replace("/(app)/chat");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };

  if (!started) {
    return (
      <View style={[styles.welcome, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <BrandText size={60} />
        <View style={styles.welcomeMark}>
          <View style={styles.welcomeDot} />
        </View>
        <Text style={styles.welcomeText}>
          Upload your study files and get exact, source-backed answers in seconds.
        </Text>
        <Button
          label="Get Started"
          onPress={() => setStarted(true)}
          full={false}
          icon={<ArrowRight size={18} color={colors.primaryFg} />}
          style={{ marginTop: 36, paddingHorizontal: 28 }}
        />
      </View>
    );
  }

  const continueDisabled =
    (step === 0 && !name.trim()) || (step === 1 && !university.trim());

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <BrandText size={22} />
        <Text style={styles.stepLabel}>
          Step {step + 1} of {STEPS.length}
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          {
            paddingBottom:
              insets.bottom + 24 + (Platform.OS === "android" ? keyboardHeight : 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.progressRow}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSeg,
                { backgroundColor: i <= step ? colors.accent : colors.border },
              ]}
            />
          ))}
        </View>

        <Card>
          <Text style={styles.stepKicker}>{STEPS[step]}</Text>

          {step === 0 && (
            <>
              <Text style={styles.stepTitle}>What's your name?</Text>
              <Text style={styles.stepDesc}>We use this to personalize your study sessions.</Text>
              <Field
                value={name}
                onChangeText={setName}
                placeholder="Your full name"
                style={{ marginTop: 20 }}
                autoFocus
              />
            </>
          )}

          {step === 1 && (
            <>
              <Text style={styles.stepTitle}>Where are you studying?</Text>
              <Text style={styles.stepDesc}>
                Your school and current level help answers fit your course.
              </Text>
              <Field
                value={university}
                onChangeText={setUniversity}
                placeholder="School, college, or university"
                style={{ marginTop: 20 }}
              />
              <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Current year/level</Text>
              <View style={styles.grid}>
                {YEARS.map((item) => (
                  <SelectBox
                    key={item}
                    label={item}
                    active={year === item}
                    onPress={() => setYear(item)}
                    width="31%"
                  />
                ))}
              </View>
            </>
          )}

          {step === 2 && (
            <>
              <Text style={styles.stepTitle}>Your exam format?</Text>
              <Text style={styles.stepDesc}>
                We'll tailor exam tips and practice questions to match.
              </Text>
              <View style={[styles.grid, { marginTop: 20 }]}>
                {EXAM_FORMATS.map((item) => (
                  <SelectBox
                    key={item.value}
                    label={item.label}
                    active={examFormat === item.value}
                    onPress={() => setExamFormat(item.value)}
                    width="48%"
                  />
                ))}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <Text style={styles.stepTitle}>How should we explain?</Text>
              <Text style={styles.stepDesc}>You can switch this any time during a chat.</Text>
              <View style={{ marginTop: 20, gap: 12 }}>
                {MODES.map((item) => (
                  <Pressable
                    key={item.v}
                    onPress={() => setMode(item.v)}
                    style={[
                      styles.modeCard,
                      mode === item.v ? styles.modeCardActive : styles.modeCardIdle,
                    ]}
                  >
                    <Text style={styles.modeTitle}>{item.title}</Text>
                    <Text style={styles.modeBody}>{item.body}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          <View style={styles.navRow}>
            <Pressable onPress={prev} disabled={step === 0} hitSlop={8} style={styles.backBtn}>
              <ArrowLeft size={16} color={step === 0 ? colors.mutedDim : colors.muted} />
              <Text style={[styles.backText, { opacity: step === 0 ? 0.3 : 1 }]}>Back</Text>
            </Pressable>
            {step < STEPS.length - 1 ? (
              <Button
                label="Continue"
                onPress={next}
                disabled={continueDisabled}
                full={false}
                icon={<ArrowRight size={16} color={colors.primaryFg} />}
              />
            ) : (
              <Button
                label="Start studying"
                onPress={finish}
                loading={saving}
                full={false}
                icon={<ArrowRight size={16} color={colors.primaryFg} />}
              />
            )}
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function SelectBox({
  label,
  active,
  onPress,
  width,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  width: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.selectBox,
        { width: width as any },
        active ? styles.selectActive : styles.selectIdle,
      ]}
    >
      <Text style={[styles.selectLabel, { color: active ? colors.accent : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  welcome: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  welcomeMark: {
    marginTop: 32,
    width: 84,
    height: 84,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  welcomeDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.accent,
  },
  welcomeText: {
    marginTop: 32,
    color: colors.muted,
    fontSize: 15,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  stepLabel: { color: colors.muted, fontSize: 12 },
  scroll: { paddingHorizontal: 20, paddingTop: 8 },
  progressRow: { flexDirection: "row", gap: 4, marginBottom: 16 },
  progressSeg: { flex: 1, height: 4, borderRadius: radius.full },
  stepKicker: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stepTitle: { color: colors.text, fontSize: 28, fontWeight: "300", marginTop: 10 },
  stepDesc: { color: colors.muted, fontSize: 14, marginTop: 6 },
  fieldLabel: { color: colors.muted, fontSize: 12, fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  selectBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  selectActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  selectIdle: { borderColor: colors.border, backgroundColor: colors.bg },
  selectLabel: { fontSize: 14, fontWeight: "600" },
  modeCard: { borderRadius: radius.md, borderWidth: 1, padding: 16 },
  modeCardActive: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
  modeCardIdle: { borderColor: colors.border, backgroundColor: colors.bg },
  modeTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  modeBody: { color: colors.muted, fontSize: 13, marginTop: 4 },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 28,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  backText: { color: colors.muted, fontSize: 14, fontWeight: "600" },
});
