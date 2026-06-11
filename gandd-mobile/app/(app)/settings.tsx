import { useState } from "react";
import { router } from "expo-router";
import { ChevronRight, LogOut, Trash2, User } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "@/components/toast";
import { Eyebrow } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar, useHaptics } from "@/platform";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const { user, profile, signOut, deleteAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [haptInts, setHaptInts] = useState(true);

  const confirmDelete = () => {
    Alert.alert(
      "Delete account",
      "This permanently deletes your account and all associated data — documents, conversations, study plans, and profile. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              await deleteAccount();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Failed to delete account");
              setDeleting(false);
            }
          },
        },
      ],
    );
  };

  const meta = [profile?.year, profile?.university].filter(Boolean).join(" · ");
  const name = profile?.name?.trim() || user?.email?.split("@")[0] || "Student";

  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Settings" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <User size={24} color={colors.accent} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            {meta ? (
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            ) : null}
            {user?.email ? (
              <Text style={styles.email} numberOfLines={1}>
                {user.email}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.detailGrid}>
          <Detail label="Exam format" value={profile?.exam_format || "—"} />
          <Detail label="Explanation" value={profile?.preferred_mode || "—"} />
        </View>

        {/* Preferences */}
        <Eyebrow style={{ marginTop: 8 }}>Preferences</Eyebrow>
        <View style={styles.group}>
          <View style={styles.row}>
            <Text style={styles.rowLabel}>Haptic feedback</Text>
            <Switch
              value={haptInts}
              onValueChange={(v) => {
                setHaptInts(v);
                if (v) haptics.selection();
              }}
              trackColor={{ true: colors.primary, false: colors.surfaceElevated }}
              thumbColor={colors.text}
            />
          </View>
          <View style={styles.divider} />
          <Pressable style={styles.row} onPress={() => router.push("/onboarding")}>
            <Text style={styles.rowLabel}>Edit study profile</Text>
            <ChevronRight size={18} color={colors.mutedDim} />
          </Pressable>
        </View>

        {/* Account */}
        <Eyebrow style={{ marginTop: 8 }}>Account</Eyebrow>
        <View style={styles.group}>
          <Pressable style={styles.row} onPress={() => void signOut()}>
            <View style={styles.rowLeft}>
              <LogOut size={19} color={colors.text} />
              <Text style={styles.rowLabel}>Sign out</Text>
            </View>
            <ChevronRight size={18} color={colors.mutedDim} />
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.row} onPress={confirmDelete} disabled={deleting}>
            <View style={styles.rowLeft}>
              <Trash2 size={19} color={colors.danger} />
              <Text style={[styles.rowLabel, { color: colors.danger }]}>
                {deleting ? "Deleting..." : "Delete account"}
              </Text>
            </View>
          </Pressable>
        </View>

        <Text style={styles.version}>G&D · native app</Text>
      </ScrollView>
    </ScreenContainer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  profileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: radius.full,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  name: {
    fontFamily: fonts.soraSemibold,
    fontSize: 18,
    color: colors.text,
  },
  meta: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.muted,
    marginTop: 2,
  },
  email: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedDim,
    marginTop: 3,
  },
  detailGrid: {
    flexDirection: "row",
    gap: 10,
  },
  detail: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  detailLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.mutedDim,
  },
  detailValue: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.text,
    marginTop: 4,
  },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
  },
  rowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  version: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedDim,
    textAlign: "center",
    marginTop: 20,
  },
});
