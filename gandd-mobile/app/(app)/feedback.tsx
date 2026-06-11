import { useState } from "react";
import { router } from "expo-router";
import { Heart, Send, Star } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { toast } from "@/components/toast";
import { Eyebrow } from "@/components/ui";
import { colors, fonts, radius } from "@/lib/theme";
import { ScreenContainer, TopBar, useHaptics } from "@/platform";

const TOPICS = ["Accuracy", "Speed", "Design", "Features", "Bug"];

export default function FeedbackScreen() {
  const insets = useSafeAreaInsets();
  const haptics = useHaptics();
  const [rating, setRating] = useState(0);
  const [topic, setTopic] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const submit = () => {
    if (!message.trim()) {
      toast.error("Add a short note before sending.");
      return;
    }
    haptics.success();
    toast.success("Thanks — your feedback was sent");
    setRating(0);
    setTopic(null);
    setMessage("");
  };

  return (
    <ScreenContainer swipeBack onBack={() => router.back()}>
      <TopBar title="Feedback" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Heart size={22} color={colors.accent} />
          </View>
          <Text style={styles.h1}>Help shape G&D</Text>
          <Text style={styles.sub}>
            Tell us what's working and what to improve. We read every note.
          </Text>
        </View>

        <Eyebrow>How was your experience?</Eyebrow>
        <View style={styles.stars}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Pressable
              key={n}
              hitSlop={6}
              onPress={() => {
                haptics.selection();
                setRating(n);
              }}
            >
              <Star
                size={32}
                color={n <= rating ? colors.accent : colors.borderStrong}
                fill={n <= rating ? colors.accent : "transparent"}
              />
            </Pressable>
          ))}
        </View>

        <Eyebrow style={{ marginTop: 8 }}>Topic</Eyebrow>
        <View style={styles.topicRow}>
          {TOPICS.map((t) => {
            const active = topic === t;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  haptics.selection();
                  setTopic(active ? null : t);
                }}
                style={[styles.topic, active && styles.topicActive]}
              >
                <Text style={[styles.topicLabel, active && { color: colors.primaryFg }]}>{t}</Text>
              </Pressable>
            );
          })}
        </View>

        <Eyebrow style={{ marginTop: 8 }}>Your message</Eyebrow>
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="What should we change, add, or fix?"
          placeholderTextColor={colors.mutedDim}
          multiline
          style={styles.input}
        />

        <Pressable onPress={submit} style={styles.submit}>
          <Send size={17} color={colors.primaryFg} />
          <Text style={styles.submitLabel}>SEND FEEDBACK</Text>
        </Pressable>
      </ScrollView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 12,
  },
  hero: {
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  h1: {
    fontFamily: fonts.soraSemibold,
    fontSize: 24,
    color: colors.text,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.mutedDim,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 12,
  },
  stars: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 4,
  },
  topicRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  topic: {
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  topicActive: {
    backgroundColor: colors.primary,
  },
  topicLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.muted,
  },
  input: {
    backgroundColor: colors.surfaceLowest,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: 16,
    minHeight: 130,
    textAlignVertical: "top",
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
  },
  submit: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 16,
    marginTop: 4,
  },
  submitLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.primaryFg,
  },
});
