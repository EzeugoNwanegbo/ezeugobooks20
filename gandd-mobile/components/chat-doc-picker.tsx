// Bottom-sheet picker for attaching library documents to a chat. Manages its own
// temporary selection so the parent only hears the final set on "Attach" — this
// avoids stale-closure issues with the modal system's captured render function.
import { Check, FileText, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import type { LinkDocument } from "@/lib/links-client";
import { colors, fonts, radius } from "@/lib/theme";

export function ChatDocPicker({
  docs,
  initial,
  onConfirm,
  close,
}: {
  docs: LinkDocument[];
  initial: string[];
  onConfirm: (ids: string[]) => void;
  close: () => void;
}) {
  const [selected, setSelected] = useState<string[]>(initial);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? docs.filter((d) => d.file_name.toLowerCase().includes(q)) : docs;
  }, [docs, query]);

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

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

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <Text style={styles.empty}>
            {docs.length === 0 ? "No indexed documents yet. Upload PDFs in the Library tab." : "No files match your search."}
          </Text>
        ) : (
          filtered.map((doc) => {
            const on = selected.includes(doc.id);
            return (
              <Pressable key={doc.id} onPress={() => toggle(doc.id)} style={styles.row}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on ? <Check size={13} color={colors.primaryFg} /> : null}
                </View>
                <FileText size={18} color={colors.mutedDim} />
                <Text style={styles.rowName} numberOfLines={1}>
                  {doc.file_name}
                </Text>
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
  rowName: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.text },
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
