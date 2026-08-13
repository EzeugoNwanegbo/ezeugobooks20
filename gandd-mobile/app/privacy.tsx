// Privacy policy — native port of src/routes/privacy.tsx. Google Play
// requires this to be reachable from inside the app (not just the website),
// so it lives outside the (app) group next to auth.tsx and onboarding.tsx —
// reachable whether or not the student is signed in.
//
// The copy below is verbatim from the web page: same sections, same numbers,
// same third-party list, same effective date. Only the presentation changed
// (RN Text/View instead of styled <section>/<table>), because this is a legal
// document and rewording it here would leave the two platforms disagreeing
// about what G&D actually does with a student's data.
import { router } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar } from "@/platform";

const EFFECTIVE_DATE = "27 May 2026";
const CONTACT_EMAIL = "nwanegboezeugo@gmail.com";

const DATA_TABLE: { cat: string; ex: string; purpose: string }[] = [
  { cat: "Account info", ex: "Name, email address", purpose: "Authentication and personalisation" },
  {
    cat: "Profile info",
    ex: "University, year, course, exam format, preferred mode",
    purpose: "Tailoring AI responses to your study context",
  },
  {
    cat: "Documents",
    ex: "Text extracted from uploaded PDFs and notes",
    purpose: "Powering document search and AI answers",
  },
  { cat: "Conversations", ex: "Chat messages and AI responses", purpose: "Displaying your chat history" },
  {
    cat: "Study data",
    ex: "Study plans, topics, sessions, answers",
    purpose: "StudyBody feature functionality",
  },
  { cat: "Usage data", ex: "Pages visited, features used", purpose: "Improving the app (via Supabase logs)" },
];

export default function PrivacyScreen() {
  const insets = useSafeAreaInsets();
  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Privacy Policy" onBack={() => router.back()} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.effective}>Effective date: {EFFECTIVE_DATE}</Text>

        <Section title="1. Who we are">
          <Para>
            G&D ("we", "our", "us") is a study tool that helps students search large documents and get
            precise, source-backed answers. The app is available on the web and as an Android app. For
            questions about this policy, email us at{" "}
            <Link onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>{CONTACT_EMAIL}</Link>.
          </Para>
        </Section>

        <Section title="2. Data we collect">
          <Para>We collect the following categories of personal data when you use G&D:</Para>
          <View style={styles.table}>
            {DATA_TABLE.map((row) => (
              <View key={row.cat} style={styles.tableRow}>
                <Text style={styles.tableCat}>{row.cat}</Text>
                <Text style={styles.tableEx}>{row.ex}</Text>
                <Text style={styles.tablePurpose}>{row.purpose}</Text>
              </View>
            ))}
          </View>
          <Para style={{ marginTop: 10 }}>
            Raw PDF files are processed entirely on your device using Tesseract.js. Only the extracted
            text is sent to our servers — the original file is never uploaded.
          </Para>
        </Section>

        <Section title="3. How we use your data">
          <Bullets
            items={[
              "To provide and operate the G&D service",
              "To personalise AI responses using your study profile (name, university, course, preferences)",
              "To retrieve relevant passages from your uploaded documents",
              "To store and display your conversation and study history",
              "To authenticate you and secure your account",
            ]}
          />
          <Para style={{ marginTop: 10 }}>
            We do not use your data for advertising, sell it to third parties, or use it to train AI
            models.
          </Para>
        </Section>

        <Section title="4. Third parties we share data with">
          <Para style={{ marginBottom: 8 }}>
            To operate the service we share certain data with the following third parties:
          </Para>
          <Bullets
            items={[
              "Supabase — our backend provider. Stores your account, profile, documents, conversations, and study data. Data is encrypted at rest and in transit. See supabase.com/privacy.",
              "DeepSeek — AI provider used for document retrieval and drafting answers. Your study profile and relevant document excerpts are sent with each request. See deepseek.com/privacy.",
              "OpenAI — AI provider used for final answer styling and web search. Your study profile and DeepSeek's draft are sent with each request. See openai.com/policies/privacy-policy.",
              "Google — if you sign in with Google, Google shares your name and email address with us via OAuth. See policies.google.com/privacy.",
            ]}
          />
        </Section>

        <Section title="5. Data security">
          <Para>
            All data is transmitted over HTTPS. Your data is stored in Supabase, which encrypts data at
            rest. Access to your data is restricted by row-level security policies — you can only read
            and write your own records. Authentication uses industry-standard JWT tokens.
          </Para>
        </Section>

        <Section title="6. Data retention">
          <Para>
            We retain your data for as long as your account is active. If you delete your account, all
            associated data — profile, documents, conversations, study plans, and authentication
            credentials — is permanently and immediately deleted with no retention period. See{" "}
            <Link onPress={() => router.push("/delete-account")}>account deletion</Link> for
            instructions.
          </Para>
        </Section>

        <Section title="7. Your rights">
          <Para style={{ marginBottom: 8 }}>You have the right to:</Para>
          <Bullets
            items={[
              "Delete your account and all data — from within the app (menu → Delete account) or by emailing us",
              "Delete specific data — delete individual documents, conversations, or messages from within the app at any time",
              "Access your data — email us and we will provide a copy of the personal data we hold about you",
              "Correct your data — update your profile from within the app",
            ]}
          />
          <Para style={{ marginTop: 10 }}>
            To exercise any of these rights, email{" "}
            <Link onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>{CONTACT_EMAIL}</Link>. We
            will respond within 7 days.
          </Para>
        </Section>

        <Section title="8. Children's privacy">
          <Para>
            G&D is not directed at children under 13. We do not knowingly collect personal data from
            children under 13. If you believe a child under 13 has provided us with personal data,
            please contact us and we will delete it promptly.
          </Para>
        </Section>

        <Section title="9. Changes to this policy">
          <Para>
            We may update this policy from time to time. We will post the new policy on this page with
            an updated effective date. Continued use of G&D after changes constitutes acceptance of the
            revised policy.
          </Para>
        </Section>

        <Section title="10. Contact">
          <Para>
            Questions, requests, or concerns about this policy:{" "}
            <Link onPress={() => Linking.openURL(`mailto:${CONTACT_EMAIL}`)}>{CONTACT_EMAIL}</Link>
          </Para>
        </Section>
      </ScrollView>
    </ScreenContainer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Para({ children, style }: { children: React.ReactNode; style?: object }) {
  return <Text style={[styles.para, style]}>{children}</Text>;
}

function Bullets({ items }: { items: string[] }) {
  return (
    <View style={{ gap: 6 }}>
      {items.map((item) => (
        <View key={item} style={styles.bulletRow}>
          <Text style={styles.bulletDot}>{"•"}</Text>
          <Text style={styles.para}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function Link({ children, onPress }: { children: React.ReactNode; onPress: () => void }) {
  return (
    <Text style={styles.link} onPress={onPress}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 20, paddingTop: 4, gap: 4 },
  effective: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.mutedDim,
    marginBottom: 8,
  },
  section: { marginTop: 22 },
  sectionTitle: {
    fontFamily: fonts.soraSemibold,
    fontSize: 15.5,
    color: colors.text,
    marginBottom: 8,
    lineHeight: 21,
  },
  para: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.muted,
    lineHeight: 20,
  },
  bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bulletDot: { fontFamily: fonts.body, fontSize: 13.5, color: colors.accent, lineHeight: 20 },
  link: { color: colors.accent, textDecorationLine: "underline" },
  table: {
    marginTop: 4,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  tableRow: {
    padding: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: 3,
  },
  tableCat: { fontFamily: fonts.bodySemibold, fontSize: 12.5, color: colors.text },
  tableEx: { fontFamily: fonts.body, fontSize: 12, color: colors.muted, lineHeight: 17 },
  tablePurpose: { fontFamily: fonts.body, fontSize: 11.5, color: colors.mutedDim, lineHeight: 16 },
});
