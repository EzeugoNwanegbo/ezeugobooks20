import { useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Plus, Send, Sparkles, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatDocPicker } from "@/components/chat-doc-picker";
import { Eyebrow, Tag } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  type ChatMode,
  type ChatTurn,
  type DocumentMode,
  looksCasualMessage,
  retrieveChatContext,
  streamChat,
} from "@/lib/chat-client";
import { type LinkDocument, listDocuments } from "@/lib/links-client";
import { colors, fonts, radius } from "@/lib/theme";
import {
  BOTTOM_NAV_HEIGHT,
  ScreenContainer,
  TopBar,
  useDrawer,
  useHaptics,
  useModal,
} from "@/platform";

const MODES: ChatMode[] = ["Detailed", "Simplified", "Storytelling", "Visuals"];

type Msg =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      mode: string;
      text: string;
      cites: string[];
      streaming?: boolean;
    };

let msgSeq = 0;
const nextId = () => `${Date.now()}-${msgSeq++}`;

export default function ChatScreen() {
  const { open } = useDrawer();
  const haptics = useHaptics();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { present } = useModal();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [mode, setMode] = useState<ChatMode>("Detailed");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [libraryDocs, setLibraryDocs] = useState<LinkDocument[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [keyboardShown, setKeyboardShown] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);

  // While the keyboard is up the composer is lifted, so we drop the reserved
  // bottom-nav + safe-area padding — otherwise the input floats far above the
  // keyboard with a large empty gap.
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

  // Load the whole library so the attach picker can list every file. Only
  // "ready" files have the chunks retrieval needs, so the picker shows the
  // others with a status label but keeps them non-selectable. Exposed as a
  // callback so the picker can refresh after uploading a new PDF in place.
  const reloadDocs = useCallback(async () => {
    const docs = await listDocuments();
    setLibraryDocs(docs);
    return docs;
  }, []);

  useEffect(() => {
    void reloadDocs().catch(() => {
      /* picker just shows an empty state if the library can't load */
    });
  }, [reloadDocs]);

  const attachedDocs = libraryDocs.filter((d) => selectedDocIds.includes(d.id));

  const openPicker = useCallback(() => {
    // The composer keyboard may be up when the paperclip is tapped; dismiss it
    // so the sheet isn't presented behind it.
    Keyboard.dismiss();
    present((close) => (
      <ChatDocPicker
        docs={libraryDocs}
        initial={selectedDocIds}
        onConfirm={setSelectedDocIds}
        reload={reloadDocs}
        close={close}
      />
    ));
  }, [present, libraryDocs, selectedDocIds, reloadDocs]);

  const scrollToEnd = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    if (!profile) {
      Alert.alert("Almost there", "Finish onboarding before chatting with G&D.");
      return;
    }
    haptics.medium();

    // Build the history the function sees from the finalized turns so far.
    const history: ChatTurn[] = messages
      .filter((m) => m.text.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.text }));
    history.push({ role: "user", content: text });

    const assistantId = nextId();
    setMessages((cur) => [
      ...cur,
      { id: nextId(), role: "user", text },
      { id: assistantId, role: "assistant", mode: `${mode} Mode`, text: "", cites: [], streaming: true },
    ]);
    setDraft("");
    setSending(true);
    scrollToEnd();

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>) =>
      setMessages((cur) =>
        cur.map((m) => (m.id === assistantId && m.role === "assistant" ? fn(m) : m)),
      );

    // Retrieve grounding excerpts before streaming. Attached files scope the
    // search; otherwise we search the whole library, skipping casual greetings.
    const manuallySelected = selectedDocIds.length > 0;
    let documents: Awaited<ReturnType<typeof retrieveChatContext>> = [];
    if (manuallySelected || !looksCasualMessage(text)) {
      const recentText = messages.slice(-6).map((m) => m.text).join(" ");
      documents = await retrieveChatContext(text, selectedDocIds, recentText);
    }
    const documentMode: DocumentMode = manuallySelected
      ? "selected"
      : documents.length > 0
        ? "smart"
        : "none";

    await streamChat({
      messages: history,
      profile,
      mode,
      documents,
      documentMode,
      signal: controller.signal,
      onDelta: (chunk) => patch((m) => ({ ...m, text: m.text + chunk })),
      onSources: (sources) =>
        patch((m) => ({
          ...m,
          cites: [...m.cites, ...sources.map((s) => s.title).filter(Boolean)].slice(0, 6),
        })),
      onError: (message) =>
        patch((m) => ({ ...m, text: m.text || `⚠️ ${message}`, streaming: false })),
      onDone: () => patch((m) => ({ ...m, streaming: false })),
    });

    setSending(false);
    abortRef.current = null;
    scrollToEnd();
  };

  const newChat = () => {
    haptics.light();
    abortRef.current?.abort();
    setSending(false);
    setMessages([]);
  };

  return (
    <ScreenContainer>
      <TopBar
        onMenu={open}
        right={
          <Pressable hitSlop={10} onPress={newChat} style={styles.topBtn}>
            <Plus size={20} color={colors.text} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={8}
      >
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        >
          {messages.map((m) =>
            m.role === "user" ? (
              <View key={m.id} style={styles.userBubble}>
                <Text style={styles.userText}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={styles.assistantBubble}>
                <View style={styles.assistantHead}>
                  <Sparkles size={12} color={colors.accent} />
                  <Eyebrow>{`Assistant · ${m.mode}`}</Eyebrow>
                  {m.streaming ? (
                    <ActivityIndicator size="small" color={colors.mutedDim} style={{ marginLeft: 2 }} />
                  ) : null}
                </View>
                {m.text ? (
                  <Text style={styles.assistantText}>{m.text}</Text>
                ) : m.streaming ? (
                  <Text style={[styles.assistantText, { color: colors.mutedDim }]}>Thinking…</Text>
                ) : null}
                {m.cites.length > 0 ? (
                  <View style={styles.cites}>
                    {m.cites.map((c) => (
                      <Tag key={c} label={c} />
                    ))}
                  </View>
                ) : null}
              </View>
            ),
          )}
          {messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <Sparkles size={26} color={colors.accent} />
              <Text style={styles.emptyTitle}>Ask anything about your material</Text>
              <Text style={styles.emptySub}>
                Answers are grounded in your loaded documents with page-level citations.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <View
          style={[
            styles.footer,
            { paddingBottom: keyboardShown ? 8 : BOTTOM_NAV_HEIGHT + insets.bottom + 8 },
          ]}
        >
          <View style={styles.modeRow}>
            {MODES.map((mm) => {
              const active = mm === mode;
              return (
                <Pressable
                  key={mm}
                  onPress={() => {
                    haptics.selection();
                    setMode(mm);
                  }}
                  style={[styles.modeChip, active && styles.modeChipActive]}
                >
                  <Text style={[styles.modeLabel, { color: active ? colors.primaryFg : colors.mutedDim }]}>
                    {mm}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {attachedDocs.length > 0 ? (
            <View style={styles.chipRow}>
              {attachedDocs.map((doc) => (
                <Pressable
                  key={doc.id}
                  onPress={() => {
                    haptics.selection();
                    setSelectedDocIds((cur) => cur.filter((id) => id !== doc.id));
                  }}
                  style={styles.chip}
                >
                  <Paperclip size={11} color={colors.accent} />
                  <Text style={styles.chipText} numberOfLines={1}>
                    {doc.file_name}
                  </Text>
                  <X size={12} color={colors.mutedDim} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.inputBar}>
            <Pressable onPress={openPicker} hitSlop={8} style={styles.attachBtn}>
              <Paperclip
                size={19}
                color={attachedDocs.length > 0 ? colors.accent : colors.mutedDim}
              />
            </Pressable>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Ask about your study material..."
              placeholderTextColor={colors.mutedDim}
              style={styles.input}
              multiline
              onSubmitEditing={send}
            />
            <Pressable
              onPress={send}
              disabled={sending || draft.trim().length === 0}
              style={[styles.sendBtn, (sending || draft.trim().length === 0) && { opacity: 0.5 }]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={colors.primaryFg} />
              ) : (
                <Send size={18} color={colors.primaryFg} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  topBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  activeRow: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  activeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.success,
  },
  activeText: {
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
    maxWidth: 220,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 16,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    borderBottomRightRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  userText: {
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderBottomLeftRadius: radius.sm,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  assistantHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  assistantText: {
    color: colors.muted,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 23,
  },
  cites: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  emptyChat: {
    alignItems: "center",
    gap: 10,
    paddingTop: 80,
    paddingHorizontal: 24,
  },
  emptyTitle: {
    color: colors.text,
    fontFamily: fonts.soraSemibold,
    fontSize: 18,
    textAlign: "center",
  },
  emptySub: {
    color: colors.mutedDim,
    fontFamily: fonts.body,
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
    backgroundColor: colors.bg,
  },
  modeRow: {
    flexDirection: "row",
    gap: 6,
  },
  modeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  modeChipActive: {
    backgroundColor: colors.primary,
  },
  modeLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 0.3,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 6,
  },
  chipText: {
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: 11,
    color: colors.muted,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingLeft: 6,
    paddingRight: 6,
    paddingVertical: 6,
  },
  attachBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  input: {
    flex: 1,
    color: colors.text,
    fontFamily: fonts.body,
    fontSize: 15,
    maxHeight: 120,
    paddingVertical: 8,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
});
