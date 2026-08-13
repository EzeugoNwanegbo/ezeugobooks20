import { router } from "expo-router";
import { MessageSquare, Search, Trash2 } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow } from "@/components/ui";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar, useHaptics } from "@/platform";

type Session = { id: string; title: string; snippet: string; when: string };

const GROUPS: { label: string; items: Session[] }[] = [
  {
    label: "Today",
    items: [
      {
        id: "1",
        title: "Synaptic pruning & the PFC",
        snippet: "Explored adolescent cortical remodeling and the gardener analogy.",
        when: "2h ago",
      },
      {
        id: "2",
        title: "Aortic valve pathology",
        snippet: "Ventricular hypertrophy mechanisms from Cardiovascular Notes.",
        when: "5h ago",
      },
    ],
  },
  {
    label: "Earlier this week",
    items: [
      {
        id: "3",
        title: "Lipid panel interpretation",
        snippet: "Walked through LDL/HDL ratios from the OCR lab report.",
        when: "Mon",
      },
      {
        id: "4",
        title: "G-protein receptor signaling",
        snippet: "Cross-document synthesis with Molecular Biology v2.",
        when: "Sun",
      },
    ],
  },
];

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();

  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="History" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.searchRow}>
          <Search size={17} color={colors.mutedDim} />
          <TextInput
            placeholder="Search conversations..."
            placeholderTextColor={colors.mutedDim}
            style={styles.searchInput}
          />
        </View>

        {GROUPS.map((group) => (
          <View key={group.label} style={{ gap: 10 }}>
            <Eyebrow style={{ marginTop: 8 }}>{group.label}</Eyebrow>
            {group.items.map((s) => (
              <Pressable
                key={s.id}
                onPress={() => {
                  haptics.selection();
                  router.replace("/chat");
                }}
                style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.surface }]}
              >
                <View style={styles.itemIcon}>
                  <MessageSquare size={18} color={colors.muted} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.itemTitleRow}>
                    <Text style={styles.itemTitle} numberOfLines={1}>
                      {s.title}
                    </Text>
                    <Text style={styles.itemWhen}>{s.when}</Text>
                  </View>
                  <Text style={styles.itemSnippet} numberOfLines={1}>
                    {s.snippet}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ))}

        <Pressable
          onPress={() => haptics.light()}
          style={styles.clear}
        >
          <Trash2 size={16} color={colors.danger} />
          <Text style={styles.clearLabel}>Clear history</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 14,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  item: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 14,
  },
  itemIcon: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  itemTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  itemTitle: {
    flex: 1,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.text,
  },
  itemWhen: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.mutedDim,
  },
  itemSnippet: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    marginTop: 3,
  },
  clear: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    marginTop: 8,
  },
  clearLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.danger,
  },
});
