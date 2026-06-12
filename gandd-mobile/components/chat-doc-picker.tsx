// Bottom-sheet picker for attaching library documents to a chat. Manages its own
// temporary selection so the parent only hears the final set on "Attach" — this
// avoids stale-closure issues with the modal system's captured render function.
import { Check, FileText, Plus, Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  LIBRARY_MAX_FILE_BYTES,
  type LinkDocument,
  pickPdfs,
  uploadAndExtract,
} from "@/lib/links-client";
import { colors, fonts, radius } from "@/lib/theme";

export function ChatDocPicker({
  docs,
  initial,
  onConfirm,
  reload,
  close,
}: {
  docs: LinkDocument[];
  initial: string[];
  onConfirm: (ids: string[]) => void;
  // Re-fetches the whole library and returns it, so a fresh upload shows up
  // without relying on the parent re-rendering this captured modal.
  reload: () => Promise<LinkDocument[]>;
  close: () => void;
}) {
  // Own a working copy: the modal captures this render once, so the `docs` prop
  // never updates. We seed from it and refresh locally after an in-place upload.
  const [localDocs, setLocalDocs] = useState<LinkDocument[]>(docs);
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  // Seed from the current state: the sheet can open while the keyboard is
  // already up, in which case no show event will fire.
  const [keyboardShown, setKeyboardShown] = useState(() => Keyboard.isVisible());

  // The modal container lifts the whole sheet above the keyboard; here we just
  // shrink the scrollable list while the search keyboard is up so the full sheet
  // still fits on screen above it.
  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvt, () => setKeyboardShown(true));
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? localDocs.filter((d) => d.file_name.toLowerCase().includes(q)) : localDocs;
  }, [localDocs, query]);

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // A doc is groundable when it has chunks. Native uploads track that through
  // extract_status; web uploads (gd1.online) chunk in-browser and leave the
  // column null, so a null status also counts as ready.
  const isReady = (s: LinkDocument["extract_status"]) => s == null || s === "ready";

  // Non-ready files are listed but can't be grounded on yet, so we show why.
  const statusLabel = (s: LinkDocument["extract_status"]) =>
    s === "pending" ? "Processing…" : s === "rejected" ? "Unsupported file" : "Couldn't process";

  // Upload a new PDF without leaving the chat — same path the Library uses.
  const upload = async () => {
    let assets: Awaited<ReturnType<typeof pickPdfs>>;
    try {
      assets = await pickPdfs();
    } catch {
      Alert.alert("Upload", "Couldn't open the file picker.");
      return;
    }
    if (assets.length === 0) return;

    setUploading(true);
    const failures: string[] = [];
    for (const asset of assets) {
      const r = await uploadAndExtract(asset, { maxBytes: LIBRARY_MAX_FILE_BYTES });
      if (!r.ok && r.error) failures.push(r.error);
    }
    try {
      setLocalDocs(await reload());
    } catch {
      /* keep the current list if the refresh fails */
    }
    setUploading(false);
    if (failures.length > 0) Alert.alert("Upload", failures.join("\n\n"));
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Attach documents</Text>
      <Text style={styles.sub}>Answers will be grounded in the files you pick and cite their pages.</Text>

      <View style={styles.searchRow}>
        <Search size={16} color={colors.mutedDim} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your library..."
          placeholderTextColor={colors.mutedDim}
          style={styles.searchInput}
        />
      </View>

      <Pressable onPress={upload} disabled={uploading} style={styles.uploadBtn}>
        {uploading ? (
          <ActivityIndicator size="small" color={colors.accent} />
        ) : (
          <Plus size={16} color={colors.accent} />
        )}
        <Text style={styles.uploadLabel}>
          {uploading ? "Uploading…" : "Upload a new PDF"}
        </Text>
      </Pressable>

      <ScrollView
        style={[styles.list, keyboardShown && { maxHeight: 220 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {filtered.length === 0 ? (
          <Text style={styles.empty}>
            {docs.length === 0 ? "No documents yet. Upload PDFs in the Library tab." : "No files match your search."}
          </Text>
        ) : (
          filtered.map((doc) => {
            const ready = isReady(doc.extract_status);
            const on = selected.includes(doc.id);
            return (
              <Pressable
                key={doc.id}
                onPress={ready ? () => toggle(doc.id) : undefined}
                disabled={!ready}
                style={[styles.row, !ready && styles.rowDisabled]}
              >
                <View style={[styles.check, on && styles.checkOn]}>
                  {on ? <Check size={13} color={colors.primaryFg} /> : null}
                </View>
                <FileText size={18} color={colors.mutedDim} />
                <View style={styles.rowMain}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {doc.file_name}
                  </Text>
                  {ready ? null : <Text style={styles.rowStatus}>{statusLabel(doc.extract_status)}</Text>}
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>

      <View style={styles.actions}>
        <Pressable
          onPress={() => {
            setSelected([]);
            onConfirm([]);
            close();
          }}
          style={styles.clearBtn}
        >
          <Text style={styles.clearLabel}>CLEAR</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            onConfirm(selected);
            close();
          }}
          style={styles.doneBtn}
        >
          <Text style={styles.doneLabel}>
            {selected.length > 0 ? `ATTACH ${selected.length}` : "DONE"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontFamily: fonts.soraSemibold, fontSize: 20, color: colors.text },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.mutedDim, marginTop: -6, lineHeight: 18 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  searchInput: { flex: 1, color: colors.text, fontFamily: fonts.body, fontSize: 15 },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderStrong,
    paddingVertical: 11,
  },
  uploadLabel: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 0.6, color: colors.accent },
  list: { maxHeight: 320 },
  empty: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    textAlign: "center",
    paddingVertical: 28,
    lineHeight: 19,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  rowDisabled: { opacity: 0.55 },
  rowMain: { flex: 1 },
  rowName: { fontFamily: fonts.body, fontSize: 15, color: colors.text },
  rowStatus: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.4, color: colors.mutedDim, marginTop: 3 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  clearBtn: {
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  clearLabel: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, color: colors.mutedDim },
  doneBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  doneLabel: { fontFamily: fonts.mono, fontSize: 12, letterSpacing: 1, color: colors.primaryFg },
});
