import {
  Activity,
  FileText,
  Link2,
  Plus,
  Sparkles,
  Trash2,
  User,
  Zap,
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button, Eyebrow, Tag } from "@/components/ui";
import {
  deleteDocument,
  LINK_MAX_DOCS,
  LINK_MAX_PAGES,
  type LinkDocument,
  listDocuments,
  pickPdfs,
  type SynthesisResult,
  synthesize,
  uploadAndExtract,
} from "@/lib/links-client";
import { colors, fonts, radius } from "@/lib/theme";
import { BOTTOM_NAV_HEIGHT, MainTabContainer, TopBar, useDrawer } from "@/platform";

function formatBytes(bytes: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function statusTag(doc: LinkDocument) {
  switch (doc.extract_status) {
    case "ready":
      return <Tag label="READY" tone="success" />;
    case "rejected":
      return <Tag label="TOO LARGE" tone="warning" />;
    case "error":
      return <Tag label="FAILED" tone="warning" />;
    default:
      return <Tag label="PROCESSING" tone="neutral" />;
  }
}

export default function LinksScreen() {
  const { open } = useDrawer();
  const insets = useSafeAreaInsets();

  const [docs, setDocs] = useState<LinkDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synth, setSynth] = useState<SynthesisResult | null>(null);
  const [synthDocs, setSynthDocs] = useState<Record<string, string>>({});

  const readyDocs = useMemo(() => docs.filter((d) => d.extract_status === "ready"), [docs]);

  const refresh = useCallback(async () => {
    try {
      const list = await listDocuments();
      setDocs(list);
    } catch (e) {
      Alert.alert("Couldn't load documents", e instanceof Error ? e.message : "Try again.");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onUpload = useCallback(async () => {
    if (docs.length >= LINK_MAX_DOCS) {
      Alert.alert("Limit reached", `You can keep up to ${LINK_MAX_DOCS} documents in Links.`);
      return;
    }
    let assets;
    try {
      assets = await pickPdfs();
    } catch {
      Alert.alert("Couldn't open files", "Please try again.");
      return;
    }
    if (assets.length === 0) return;

    const room = LINK_MAX_DOCS - docs.length;
    const chosen = assets.slice(0, room);
    if (assets.length > room) {
      Alert.alert(
        "Some files skipped",
        `Only ${room} more document${room === 1 ? "" : "s"} fit (max ${LINK_MAX_DOCS}).`,
      );
    }

    setUploading(true);
    const failures: string[] = [];
    let anyOversize = false;
    for (const asset of chosen) {
      const res = await uploadAndExtract(asset);
      if (!res.ok && res.status !== "rejected" && res.error) failures.push(res.error);
      if (res.oversize) anyOversize = true;
      await refresh();
    }
    setUploading(false);
    // A new document set invalidates the previous synthesis.
    setSynth(null);

    if (failures.length > 0) {
      Alert.alert(
        "Some files had problems",
        failures.join("\n\n"),
        anyOversize
          ? [
              { text: "Open gd1.online", onPress: () => void Linking.openURL("https://gd1.online") },
              { text: "OK", style: "cancel" },
            ]
          : undefined,
      );
    }
  }, [docs.length, refresh]);

  const onDelete = useCallback(
    (doc: LinkDocument) => {
      Alert.alert("Remove document?", `"${doc.file_name}" will be deleted from Links.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteDocument(doc.id);
              setSynth(null);
              await refresh();
            } catch (e) {
              Alert.alert("Couldn't remove", e instanceof Error ? e.message : "Try again.");
            }
          },
        },
      ]);
    },
    [refresh],
  );

  const onSynthesize = useCallback(
    async (force = false) => {
      if (readyDocs.length === 0) return;
      setSynthesizing(true);
      try {
        const res = await synthesize(
          readyDocs.map((d) => d.id),
          force,
        );
        setSynth(res.result);
        setSynthDocs(res.documents);
      } catch (e) {
        Alert.alert("Synthesis failed", e instanceof Error ? e.message : "Try again.");
      } finally {
        setSynthesizing(false);
      }
    },
    [readyDocs],
  );

  const nodes = (synth?.nodes ?? []).slice(0, 5);

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
        <Eyebrow>Academic Engine · Concept Interlinks</Eyebrow>
        <Text style={styles.h1}>Cross-Document Synthesis</Text>
        <Text style={styles.sub}>
          Upload your focused notes and G&D's AI connects the dots — surfacing the shared themes that
          run across separate documents.
        </Text>

        {/* Upload zone */}
        <View style={styles.uploadCard}>
          <View style={styles.uploadHead}>
            <Eyebrow>Your Library</Eyebrow>
            <Text style={styles.counter}>
              {docs.length} / {LINK_MAX_DOCS}
            </Text>
          </View>

          {loadingDocs ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading documents…</Text>
            </View>
          ) : docs.length === 0 ? (
            <Pressable
              onPress={onUpload}
              disabled={uploading}
              style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Plus size={22} color={colors.accent} />
              )}
              <Text style={styles.dropTitle}>
                {uploading ? "Uploading…" : "Upload PDFs"}
              </Text>
              <Text style={styles.dropHint}>
                PDFs only · under 30 MB and {LINK_MAX_PAGES} pages each
              </Text>
            </Pressable>
          ) : (
            <View style={{ gap: 10 }}>
              {docs.map((doc) => (
                <View key={doc.id} style={styles.docRow}>
                  <View style={styles.docIcon}>
                    <FileText size={18} color={colors.muted} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.docName} numberOfLines={1}>
                      {doc.file_name}
                    </Text>
                    <View style={styles.docMetaRow}>
                      {statusTag(doc)}
                      <Text style={styles.docMeta}>
                        {[
                          doc.page_count ? `${doc.page_count} pages` : null,
                          formatBytes(doc.file_size),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Text>
                    </View>
                    {(doc.extract_status === "rejected" || doc.extract_status === "error") &&
                    doc.extract_error ? (
                      <Text style={styles.docError}>{doc.extract_error}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => onDelete(doc)}
                    hitSlop={10}
                    style={({ pressed }) => [styles.docDelete, pressed && { opacity: 0.6 }]}
                  >
                    <Trash2 size={16} color={colors.mutedDim} />
                  </Pressable>
                </View>
              ))}

              <Button
                label={uploading ? "Uploading…" : "Add PDF"}
                variant="secondary"
                onPress={onUpload}
                loading={uploading}
                disabled={uploading || docs.length >= LINK_MAX_DOCS}
                icon={<Plus size={16} color={colors.text} />}
              />
            </View>
          )}
        </View>

        {/* Synthesize action */}
        {readyDocs.length > 0 && (
          <Button
            label={
              synthesizing
                ? "Connecting the dots…"
                : synth
                  ? "Re-synthesize"
                  : `Connect the dots (${readyDocs.length})`
            }
            onPress={() => onSynthesize(Boolean(synth))}
            loading={synthesizing}
            disabled={synthesizing}
            icon={!synthesizing ? <Sparkles size={16} color={colors.primaryFg} /> : undefined}
          />
        )}

        {readyDocs.length === 0 && docs.length > 0 && !loadingDocs ? (
          <Text style={styles.waitNote}>
            Documents are still processing (or none could be read). Add a text-based PDF to begin.
          </Text>
        ) : null}

        {/* ===== Synthesis results ===== */}
        {synth ? (
          <>
            {/* Concept graph */}
            <View style={styles.graphCard}>
              <View style={styles.graphHead}>
                <View style={styles.graphActive}>
                  <Sparkles size={12} color={colors.accent} />
                  <Text style={styles.graphActiveText} numberOfLines={1}>
                    {synth.coreTheme ? `Theme: ${synth.coreTheme}` : "Synthesis"}
                  </Text>
                </View>
                <Text style={styles.graphMeta}>
                  {nodes.length} Nodes · {synth.interlinkCount ?? nodes.length} Interlinks
                </Text>
              </View>

              <View style={styles.graph}>
                {nodes.map((node, i) => {
                  const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
                  const r = 96;
                  const x = Math.cos(angle) * r;
                  const y = Math.sin(angle) * r;
                  return (
                    <View
                      key={`${node.label}-${i}`}
                      style={[
                        styles.node,
                        styles.nodeSm,
                        { transform: [{ translateX: x }, { translateY: y }] },
                      ]}
                    >
                      <Text style={styles.nodeSmText} numberOfLines={2}>
                        {node.label}
                      </Text>
                    </View>
                  );
                })}
                <View style={styles.nodeCore}>
                  <Eyebrow style={{ color: colors.primaryFg, opacity: 0.7 }}>Core Theme</Eyebrow>
                  <Text style={styles.nodeCoreText} numberOfLines={2}>
                    {synth.coreTheme ?? "Synthesis"}
                  </Text>
                </View>
              </View>
            </View>

            {/* Strongest link */}
            {synth.strongestLink ? (
              <View style={styles.strongest}>
                <View style={styles.strongestHead}>
                  <Eyebrow style={{ color: colors.primaryFg, opacity: 0.7 }}>Strongest Link</Eyebrow>
                  <Link2 size={16} color={colors.primaryFg} />
                </View>
                <Text style={styles.strongestTitle}>{synth.strongestLink.title}</Text>
                {synth.strongestLink.description ? (
                  <Text style={styles.strongestDesc}>{synth.strongestLink.description}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Theme origin */}
            {synth.themeOrigin ? (
              <View style={styles.origin}>
                <View style={styles.originHead}>
                  <Eyebrow>Theme Origin</Eyebrow>
                  <Zap size={15} color={colors.mutedDim} />
                </View>
                <Text style={styles.originTitle}>{synth.themeOrigin.title}</Text>
                {synth.themeOrigin.source ? (
                  <Text style={styles.originSub}>{synth.themeOrigin.source}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Surprise connection */}
            {synth.surprise ? (
              <View style={styles.surprise}>
                <View style={styles.originHead}>
                  <Eyebrow style={{ color: colors.accent }}>Unexpected Link</Eyebrow>
                  <Sparkles size={15} color={colors.accent} />
                </View>
                <Text style={styles.originTitle}>{synth.surprise.title}</Text>
                {synth.surprise.description ? (
                  <Text style={styles.surpriseDesc}>{synth.surprise.description}</Text>
                ) : null}
              </View>
            ) : null}

            {/* Linked theme clusters */}
            {synth.clusters && synth.clusters.length > 0 ? (
              <>
                <View style={styles.clusterHead}>
                  <Eyebrow>Linked Theme Clusters</Eyebrow>
                  <Tag label={`${synth.clusters.length} Found`} tone="success" />
                </View>

                {synth.clusters.map((cluster, i) => (
                  <View key={`${cluster.title}-${i}`} style={styles.cluster}>
                    <View style={styles.clusterIcon}>
                      <Activity size={20} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.clusterTitleRow}>
                        <Text style={styles.clusterTitle}>{cluster.title}</Text>
                        {typeof cluster.match === "number" ? (
                          <Text style={styles.clusterMatch}>
                            {cluster.match.toFixed(2)} Match
                          </Text>
                        ) : null}
                      </View>
                      {cluster.description ? (
                        <Text style={styles.clusterDesc}>{cluster.description}</Text>
                      ) : null}
                    </View>
                  </View>
                ))}
              </>
            ) : null}
          </>
        ) : null}
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
  // Upload
  uploadCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
  },
  uploadHead: {
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
  dropzone: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingVertical: 26,
    alignItems: "center",
    gap: 6,
  },
  dropTitle: {
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.text,
    marginTop: 2,
  },
  dropHint: {
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.mutedDim,
    letterSpacing: 0.3,
  },
  docRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surfaceLowest,
    borderRadius: radius.md,
    padding: 12,
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
  docError: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.warning,
    lineHeight: 17,
    marginTop: 6,
  },
  docDelete: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  waitNote: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
    textAlign: "center",
    paddingHorizontal: 8,
  },
  // Graph
  graphCard: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
  },
  graphHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  graphActive: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 6,
    flexShrink: 1,
    maxWidth: "62%",
  },
  graphActiveText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.muted,
  },
  graphMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.mutedDim,
  },
  graph: {
    height: 250,
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  node: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  nodeSm: {
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
  },
  nodeSmText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.muted,
    textAlign: "center",
  },
  nodeCore: {
    width: 132,
    height: 132,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
  },
  nodeCoreText: {
    fontFamily: fonts.soraSemibold,
    fontSize: 16,
    color: colors.primaryFg,
    marginTop: 2,
    textAlign: "center",
  },
  // Strongest
  strongest: {
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    padding: 18,
    gap: 4,
  },
  strongestHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  strongestTitle: {
    fontFamily: fonts.soraSemibold,
    fontSize: 20,
    color: colors.primaryFg,
  },
  strongestDesc: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.primaryFg,
    opacity: 0.75,
    lineHeight: 19,
  },
  // Origin / surprise
  origin: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
    gap: 3,
  },
  surprise: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 18,
    gap: 3,
    borderWidth: 1,
    borderColor: colors.accentSoft,
  },
  originHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  originTitle: {
    fontFamily: fonts.soraSemibold,
    fontSize: 18,
    color: colors.text,
  },
  originSub: {
    fontFamily: fonts.mono,
    fontSize: 12,
    color: colors.mutedDim,
  },
  surpriseDesc: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
    marginTop: 4,
  },
  // Clusters
  clusterHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cluster: {
    flexDirection: "row",
    gap: 14,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: 16,
  },
  clusterIcon: {
    width: 44,
    height: 44,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  clusterTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  clusterTitle: {
    flex: 1,
    fontFamily: fonts.bodySemibold,
    fontSize: 15,
    color: colors.text,
  },
  clusterMatch: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.accent,
  },
  clusterDesc: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
    marginTop: 4,
  },
});
