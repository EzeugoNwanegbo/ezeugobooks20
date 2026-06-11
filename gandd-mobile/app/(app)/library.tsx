import { router } from "expo-router";
import { FileText, Plus, Search, Trash2, Upload } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Eyebrow, Tag } from "@/components/ui";
import {
  deleteDocument,
  LIBRARY_MAX_FILE_BYTES,
  type LinkDocument,
  listDocuments,
  pickPdfs,
  uploadAndExtract,
} from "@/lib/links-client";
import { colors, fonts, radius } from "@/lib/theme";
import {
  BOTTOM_NAV_HEIGHT,
  ScreenContainer,
  TopBar,
  useDrawer,
  useHaptics,
} from "@/platform";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusTag(doc: LinkDocument) {
  switch (doc.extract_status) {
    case "ready":
      return <Tag label="INDEXED" tone="success" />;
    case "rejected":
      return <Tag label="TOO LARGE" tone="warning" />;
    case "error":
      return <Tag label="FAILED" tone="warning" />;
    default:
      return <Tag label="PROCESSING" tone="neutral" />;
  }
}

export default function LibraryScreen() {
  const { open } = useDrawer();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();

  const [docs, setDocs] = useState<LinkDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");

  const refresh = useCallback(async () => {
    try {
      setDocs(await listDocuments());
    } catch (e) {
      Alert.alert("Couldn't load library", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? docs.filter((d) => d.file_name.toLowerCase().includes(q)) : docs;
  }, [docs, query]);

  const onUpload = useCallback(async () => {
    let assets;
    try {
      assets = await pickPdfs();
    } catch {
      Alert.alert("Couldn't open files", "Please try again.");
      return;
    }
    if (assets.length === 0) return;

    haptics.success();
    setUploading(true);
    const failures: string[] = [];
    for (const asset of assets) {
      const res = await uploadAndExtract(asset, { maxBytes: LIBRARY_MAX_FILE_BYTES });
      if (!res.ok && res.status !== "rejected" && res.error) failures.push(res.error);
      await refresh();
    }
    setUploading(false);
    if (failures.length > 0) Alert.alert("Some files had problems", failures.join("\n\n"));
  }, [haptics, refresh]);

  const onDelete = useCallback(
    (doc: LinkDocument) => {
      Alert.alert("Delete document?", `"${doc.file_name}" will be removed.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDocument(doc.id);
              await refresh();
            } catch (e) {
              Alert.alert("Couldn't delete", e instanceof Error ? e.message : "Try again.");
            }
          },
        },
      ]);
    },
    [refresh],
  );

  return (
    <ScreenContainer swipeBack onBack={() => router.replace("/chat")}>
      <TopBar onMenu={open} right={<View style={{ width: 40 }} />} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingBottom: BOTTOM_NAV_HEIGHT + insets.bottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.h1}>Document Library</Text>
        <Text style={styles.sub}>
          Upload your study material — it's indexed for Chat, StudyBody and Links.
        </Text>

        <View style={styles.searchRow}>
          <Search size={17} color={colors.mutedDim} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search your library..."
            placeholderTextColor={colors.mutedDim}
            style={styles.searchInput}
          />
        </View>

        <Pressable
          onPress={onUpload}
          disabled={uploading}
          style={[styles.addNew, uploading && { opacity: 0.5 }]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.primaryFg} />
          ) : (
            <Plus size={18} color={colors.primaryFg} />
          )}
          <Text style={styles.addNewLabel}>{uploading ? "UPLOADING" : "ADD NEW"}</Text>
        </Pressable>
        <Text style={styles.maxSize}>
          {docs.length} {docs.length === 1 ? "DOCUMENT" : "DOCUMENTS"} · PDF · MAX 50MB
        </Text>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.loadingText}>Loading your library…</Text>
          </View>
        ) : docs.length === 0 ? (
          <Pressable onPress={onUpload} style={styles.dropZone}>
            <Upload size={22} color={colors.mutedDim} />
            <Text style={styles.dropText}>NO DOCUMENTS YET</Text>
            <Text style={styles.dropSub}>TAP TO UPLOAD A PDF</Text>
          </Pressable>
        ) : (
          filtered.map((doc) => (
            <View key={doc.id} style={styles.docCard}>
              <View style={styles.docPreview}>
                <FileText size={26} color={colors.mutedDim} />
                <View style={styles.docStatus}>{statusTag(doc)}</View>
              </View>
              <View style={styles.docBody}>
                <View style={styles.docTitleRow}>
                  <Text style={styles.docTitle} numberOfLines={1}>
                    {doc.file_name}
                  </Text>
                  <Pressable hitSlop={10} onPress={() => onDelete(doc)}>
                    <Trash2 size={18} color={colors.mutedDim} />
                  </Pressable>
                </View>
                {(doc.extract_status === "rejected" || doc.extract_status === "error") &&
                doc.extract_error ? (
                  <Text style={styles.docError}>{doc.extract_error}</Text>
                ) : null}
                <View style={styles.docMeta}>
                  <View style={styles.docMetaLeft}>
                    <FileText size={12} color={colors.mutedDim} />
                    <Text style={styles.docMetaText}>PDF</Text>
                  </View>
                  <Text style={styles.docMetaText}>
                    {[doc.page_count ? `${doc.page_count} pages` : null, formatBytes(doc.file_size)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              </View>
            </View>
          ))
        )}

        {!loading && docs.length > 0 && filtered.length === 0 ? (
          <Text style={styles.loadingText}>No documents match "{query}".</Text>
        ) : null}
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
  h1: {
    fontFamily: fonts.soraSemibold,
    fontSize: 30,
    color: colors.text,
    lineHeight: 34,
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.mutedDim,
    marginTop: -6,
    lineHeight: 20,
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
  addNew: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingVertical: 15,
  },
  addNewLabel: {
    fontFamily: fonts.mono,
    fontSize: 12,
    letterSpacing: 1,
    color: colors.primaryFg,
  },
  maxSize: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 0.8,
    color: colors.mutedDim,
    textAlign: "center",
    marginTop: -6,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 24,
    justifyContent: "center",
  },
  loadingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    textAlign: "center",
  },
  docCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  docPreview: {
    height: 100,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  docStatus: {
    position: "absolute",
    top: 12,
    right: 12,
  },
  docBody: {
    padding: 16,
    gap: 8,
  },
  docTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  docTitle: {
    flex: 1,
    fontFamily: fonts.soraSemibold,
    fontSize: 16,
    color: colors.text,
  },
  docError: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
  },
  docMeta: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  docMetaLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  docMetaText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.mutedDim,
  },
  dropZone: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingVertical: 36,
    alignItems: "center",
    gap: 8,
  },
  dropText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: colors.muted,
  },
  dropSub: {
    fontFamily: fonts.mono,
    fontSize: 9,
    letterSpacing: 0.8,
    color: colors.mutedDim,
  },
});
