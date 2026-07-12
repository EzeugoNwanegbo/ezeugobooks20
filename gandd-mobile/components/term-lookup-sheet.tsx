// Bottom-sheet shown when a dotted-underlined key term in a chat answer is
// tapped. Fires a focused, web-grounded lookup (lib/term-lookup) and streams the
// glanceable blurb + its sources. Cancels the request if dismissed early.

import { X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Markdown } from "@/components/markdown";
import type { Profile } from "@/lib/auth";
import { lookupTerm, type TermLookupState } from "@/lib/term-lookup";
import { colors, fonts, radius } from "@/lib/theme";

export function TermLookupSheet({
  term,
  profile,
  close,
}: {
  term: string;
  profile: Profile;
  close: () => void;
}) {
  const [state, setState] = useState<TermLookupState>({ text: "", sources: [], loading: true });

  useEffect(() => {
    const controller = new AbortController();
    lookupTerm({ term, profile, onUpdate: setState, signal: controller.signal });
    return () => controller.abort();
  }, [term, profile]);

  return (
    <View>
      <View style={styles.head}>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Quick lookup</Text>
        </View>
        <Pressable onPress={close} hitSlop={10} style={styles.closeBtn}>
          <X size={18} color={colors.mutedDim} />
        </Pressable>
      </View>
      <Text style={styles.term}>{term}</Text>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{ paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
      >
        {state.text ? (
          <Markdown content={state.text} />
        ) : state.loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.loadingText}>Looking it up…</Text>
          </View>
        ) : null}

        {state.error && !state.text ? <Text style={styles.error}>{state.error}</Text> : null}

        {state.loading && state.text ? (
          <ActivityIndicator
            size="small"
            color={colors.mutedDim}
            style={{ marginTop: 8, alignSelf: "flex-start" }}
          />
        ) : null}

        {state.sources.length > 0 ? (
          <View style={styles.sources}>
            <Text style={styles.sourcesLabel}>Sources</Text>
            {state.sources.slice(0, 4).map((s, i) => (
              <Pressable
                key={`${s.url}-${i}`}
                onPress={() => void Linking.openURL(s.url)}
                style={({ pressed }) => [styles.sourceRow, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.sourceText} numberOfLines={1}>
                  {s.title || s.url}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  badgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.5,
    color: colors.accent,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  term: {
    fontFamily: fonts.soraSemibold,
    fontSize: 20,
    color: colors.text,
    marginBottom: 10,
  },
  body: {
    maxHeight: 320,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.mutedDim,
  },
  error: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.warning,
    lineHeight: 20,
    paddingVertical: 8,
  },
  sources: {
    marginTop: 14,
    gap: 6,
  },
  sourcesLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.mutedDim,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  sourceRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sourceText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.accent,
  },
});
