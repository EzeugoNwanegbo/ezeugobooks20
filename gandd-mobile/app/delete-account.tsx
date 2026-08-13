// Account deletion instructions — native port of src/routes/delete-account.tsx.
// Required alongside privacy.tsx for Google Play's account-deletion policy:
// a signed-out visitor must be able to reach instructions for deleting their
// account without installing or signing into anything, so this sits outside
// the (app) group. The actual deletion happens in Settings (useAuth().
// deleteAccount(), see app/(app)/settings.tsx) via the same delete-account
// edge function the web app calls — this screen only explains the steps and
// gives a signed-out fallback (email) for someone who can't get into the app.
import { router } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar } from "@/platform";

const CONTACT_EMAIL = "nwanegboezeugo@gmail.com";

const STEPS = [
  "Open the G&D app and sign in to your account.",
  "Tap the menu icon (top-left) to open the drawer.",
  "Scroll to Settings, then tap Delete account.",
  "Read the confirmation prompt, then tap Delete to confirm.",
];

const DELETED_DATA = [
  "Your profile (name, university, year, course, preferences)",
  "All uploaded documents and their extracted text",
  "All conversations and chat messages",
  "All study plans, topics, sessions, and answers",
  "Your authentication credentials",
];

export default function DeleteAccountScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Delete your account" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.intro}>
          You can permanently delete your G&D account and all associated data directly inside the app.
          There is no waiting period — deletion happens immediately.
        </Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Steps to delete your account in-app</Text>
          <View style={{ gap: 10 }}>
            {STEPS.map((step, i) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>What data is deleted</Text>
          <View style={{ gap: 8 }}>
            {DELETED_DATA.map((item) => (
              <View key={item} style={styles.bulletRow}>
                <Text style={styles.bulletDot}>{"•"}</Text>
                <Text style={styles.stepText}>{item}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.note}>
            Deletion is permanent and immediate. No data is retained after your account is deleted.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Need help?</Text>
          <Text style={styles.stepText}>
            If you are unable to access the app to delete your account, email us at{" "}
            <Text style={styles.link} onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>
              {CONTACT_EMAIL}
            </Text>{" "}
            with the subject line "Account deletion request" and we will delete your account and all
            associated data within 7 days.
          </Text>
        </View>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 4, gap: 16 },
  intro: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.muted,
    lineHeight: 21,
    marginBottom: 4,
  },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    gap: 12,
  },
  cardTitle: { fontFamily: fonts.soraSemibold, fontSize: 15, color: colors.text },
  stepRow: { flexDirection: "row", gap: 10, alignItems: "flex-start" },
  stepNum: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  stepNumText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.accent },
  stepText: { flex: 1, fontFamily: fonts.body, fontSize: 13.5, color: colors.muted, lineHeight: 20 },
  bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bulletDot: { fontFamily: fonts.body, fontSize: 13.5, color: colors.accent, lineHeight: 20 },
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.mutedDim,
    lineHeight: 18,
    marginTop: 2,
  },
  link: { color: colors.accent, textDecorationLine: "underline" },
});
