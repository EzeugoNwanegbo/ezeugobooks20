import { Check, FileText, RefreshCw, Share2, Sparkles, User, Zap } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Markdown } from "@/components/markdown";
import { Button, Eyebrow, Tag } from "@/components/ui";
import {
  countLabel,
  disabledReason,
  generateMasterNote,
  kindLabel,
  fileKind,
  type LibraryDoc,
  listLibraryDocs,
  LM_MAX_DOCS,
  LM_PROGRESS_STEPS,
} from "@/lib/last-minute-client";
import { colors, fonts, radius } from "@/lib/theme";
import { BOTTOM_NAV_HEIGHT, haptics, MainTabContainer, TopBar, useDrawer } from "@/platform";

export default function LastMinuteScreen() {
  const { open } = useDrawer();
  const insets = useSafeAreaInsets();

  const [docs, setDocs] = useState<LibraryDoc[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("Last Minute Master Note");

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listLibraryDocs();
      setDocs(list);
    } catch (e) {
      Alert.alert("Couldn't load your Library", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Cycle the progress copy while the note generates.
  useEffect(() => {
    if (!generating) return;
    const timer = setInterval(() => {
      setProgressIndex((v) => Math.min(v + 1, LM_PROGRESS_STEPS.length - 1));
    }, 2200);
    return () => clearInterval(timer);
  }, [generating]);

  const selectableDocs = useMemo(() => docs.filter((d) => !disabledReason(d)), [docs]);

  const toggleDoc = useCallback((doc: LibraryDoc) => {
    const reason = disabledReason(doc);
    if (reason) {
      Alert.alert("Can't use this file", reason);
      return;
    }
    haptics.selection();
    setSelected((current) => {
      if (current.includes(doc.id)) return current.filter((id) => id !== doc.id);
      if (current.length >= LM_MAX_DOCS) {
        Alert.alert("Selection full", `Pick up to ${LM_MAX_DOCS} study files.`);
        return current;
      }
      return [...current, doc.id];
    });
  }, []);

  const onGenerate = useCallback(async () => {
    if (selected.length === 0) return;
    setGenerating(true);
    setProgressIndex(0);
    setNote("");
    try {
      const result = await generateMasterNote(selected);
      setTitle(result.title);
      setNote(result.note);
      setProgressIndex(LM_PROGRESS_STEPS.length - 1);
      haptics.success();
    } catch (e) {
      Alert.alert("Couldn't generate", e instanceof Error ? e.message : "Try again.");
    } finally {
      setGenerating(false);
    }
  }, [selected]);

  const onShare = useCallback(async () => {
    if (!note) return;
    try {
      await Share.share({ message: `${title}\n\n${note}` });
    } catch {
      /* user dismissed the share sheet */
    }
  }, [note, title]);

  const onStartOver = useCallback(() => {
    setNote("");
    setSelected([]);
  }, []);

  return (
    <MainTabContainer>
      <TopBar
        onMenu={open}
        right={
          <View style={styles.avatar}>
            <User size={18} color={colors.muted} />
          </View>
        }
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Eyebrow>Exam Mode · Master Note</Eyebrow>
        <Text style={styles.h1}>Last Minute</Text>
        <Text style={styles.sub}>
          Pick the study files you're revising and G&D condenses them into one clean Master Note —
          repeated points merged, overlaps balanced, ready to cram.
        </Text>

        {/* ===== Result view ===== */}
        {note ? (
          <>
            <View style={styles.resultCard}>
              <View style={styles.resultHead}>
                <View style={styles.resultBadge}>
                  <Sparkles size={12} color={colors.accent} />
                  <Text style={styles.resultBadgeText}>Master Note</Text>
                </View>
                <Text style={styles.resultMeta}>{selected.length} files merged</Text>
              </View>
              <Text style={styles.resultTitle}>{title}</Text>
              <View style={styles.noteBody}>
                <Markdown content={note} />
              </View>
            </View>

            <Button
              label="Share Master Note"
              onPress={onShare}
              icon={<Share2 size={16} color={colors.primaryFg} />}
            />
            <Button
              label="Start over"
              variant="secondary"
              onPress={onStartOver}
              icon={<RefreshCw size={16} color={colors.text} />}
            />
          </>
        ) : (
          <>
            {/* ===== Selection view ===== */}
            <View style={styles.selectCard}>
              <View style={styles.selectHead}>
                <Eyebrow>Your Study Files</Eyebrow>
                <Text style={styles.counter}>
                  {selected.length} / {LM_MAX_DOCS}
                </Text>
              </View>

              {loading ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color={colors.accent} />
                  <Text style={styles.loadingText}>Loading your Library…</Text>
                </View>
              ) : docs.length === 0 ? (
                <Text style={styles.empty}>
                  No study files yet. Add notes in your Library first, then come back to build a
                  Master Note.
                </Text>
              ) : selectableDocs.length === 0 ? (
                <Text style={styles.empty}>
                  None of your files are ready yet (still processing, too long, or an unsupported
                  type).
                </Text>
              ) : (
                <View style={{ gap: 10 }}>
                  {docs.map((doc) => {
                    const reason = disabledReason(doc);
                    const isSelected = selected.includes(doc.id);
                    const kind = fileKind(doc);
                    return (
                      <Pressable
                        key={doc.id}
                        onPress={() => toggleDoc(doc)}
                        style={({ pressed }) => [
                          styles.docRow,
                          isSelected && styles.docRowSelected,
                          reason && styles.docRowDisabled,
                          pressed && !reason && { opacity: 0.8 },
                        ]}
                      >
                        <View style={[styles.checkbox, isSelected && styles.checkboxOn]}>
                          {isSelected ? <Check size={14} color={colors.primaryFg} /> : null}
                        </View>
                        <View style={styles.docIcon}>
                          <FileText size={18} color={colors.muted} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.docName} numberOfLines={1}>
                            {doc.file_name}
                          </Text>
                          <View style={styles.docMetaRow}>
                            <Tag label={kindLabel(kind).toUpperCase()} tone="neutral" />
                            <Text style={styles.docMeta}>{countLabel(doc)}</Text>
                          </View>
                          {reason ? <Text style={styles.docReason}>{reason}</Text> : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {generating ? (
              <View style={styles.progress}>
                <ActivityIndicator size="small" color={colors.accent} />
                <Text style={styles.progressText}>{LM_PROGRESS_STEPS[progressIndex]}…</Text>
              </View>
            ) : (
              <Button
                label={
                  selected.length === 0
                    ? "Select files to begin"
                    : `Build Master Note (${selected.length})`
                }
                onPress={onGenerate}
                disabled={selected.length === 0}
                icon={selected.length > 0 ? <Zap size={16} color={colors.primaryFg} /> : undefined}
              />
            )}
          </>
        )}
      </ScrollView>
    </MainTabContainer>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 4,
    gap: 16,
  },
  h1: {
    fontFamily: fonts.soraSemibold,
    fontSize: 28,
    color: colors.text,
    lineHeight: 32,
    marginTop: 4,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    color: colors.mutedDim,
    lineHeight: 20,
    marginTop: -8,
  },
  // Selection
  selectCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
  },
  selectHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  counter: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedDim,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 18,
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
  },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
    paddingVertical: 8,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceLowest,
    borderRadius: radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  docRowSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.tint,
  },
  docRowDisabled: {
    opacity: 0.5,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  docIcon: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  docName: {
    fontFamily: fonts.bodySemibold,
    fontSize: 14,
    color: colors.text,
  },
  docMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  docMeta: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.mutedDim,
  },
  docReason: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
    marginTop: 6,
  },
  // Progress
  progress: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
  },
  progressText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
    flex: 1,
  },
  // Result
  resultCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
  },
  resultHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  resultBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  resultBadgeText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.accent,
  },
  resultMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.mutedDim,
  },
  resultTitle: {
    fontFamily: fonts.soraSemibold,
    fontSize: 20,
    color: colors.text,
    marginBottom: 8,
  },
  noteBody: {
    marginTop: 4,
  },
});
