import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Paperclip, Plus, Send, Square, X } from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  Linking,
  Pressable,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatDocPicker } from "@/components/chat-doc-picker";
import { Markdown } from "@/components/markdown";
import { SymbioteOrb } from "@/components/symbiote";
import { TermLookupSheet } from "@/components/term-lookup-sheet";
import { Eyebrow } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import {
  type ChatMode,
  type ChatTurn,
  type DocumentMode,
  looksCasualMessage,
  retrieveChatContext,
  streamChat,
  type WebSource,
} from "@/lib/chat-client";
import {
  createConversation,
  deriveTitle,
  loadConversationMessages,
  saveMessage,
  touchConversation,
} from "@/lib/conversations";
import { type LinkDocument, listDocuments } from "@/lib/links-client";
import { detectKeyTerms } from "@/lib/term-lookup";
import { colors, fonts, radius } from "@/lib/theme";
import {
  BOTTOM_NAV_HEIGHT,
  MainTabContainer,
  TopBar,
  useConversation,
  useDrawer,
  useHaptics,
  useKeyboardHeight,
  useModal,
} from "@/platform";

const MODES: ChatMode[] = ["Detailed", "Simplified", "Storytelling", "Visuals"];

// Shown above the answer whenever the user asks a real question without attaching
// a file — tells them to add one for a grounded answer, then the AI's own answer
// streams in underneath.
const ATTACH_TIP =
  "📎 **Add a file for a grounded answer.** Tap the paperclip below to attach a PDF, or upload one in **Library**, then ask again and I'll answer from your material with page citations.\n\n" +
  "_Here's a general answer in the meantime:_\n\n";

type Msg =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      mode: string;
      text: string;
      sources: WebSource[];
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
  const keyboardHeight = useKeyboardHeight();
  const keyboardShown = keyboardHeight > 0;
  const scrollRef = useRef<ScrollView>(null);
  const abortRef = useRef<AbortController | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const { openId, clearOpen } = useConversation();

  // Composer auto-hide: collapse the input away when the user scrolls down
  // through an answer (more reading room), restore it on scroll-up. Disabled
  // while the keyboard is up. Mirrors the web chat's hide-composer-on-scroll.
  const [footerH, setFooterH] = useState(0);
  const collapse = useSharedValue(0);
  const lastScrollY = useRef(0);

  const footerAnimStyle = useAnimatedStyle(() => ({
    // Force a height only for the scroll-collapse animation while the keyboard
    // is down. When it's up, explicitly release to "auto" — returning undefined
    // leaves the last forced height (measured keyboard-down, tab-bar padding
    // included) stuck on the native view, which parked the input ~100px above
    // the keyboard inside this overflow-hidden container. "auto" also lets the
    // multiline input grow while typing.
    height: footerH > 0 && !keyboardShown ? footerH * (1 - collapse.value) : ("auto" as const),
    opacity: 1 - collapse.value * 0.5,
  }));

  const onListScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Don't fight the keyboard, and don't toggle while an answer streams (the
    // auto-scroll would flicker the composer open/closed).
    if (keyboardShown || sending) return;
    const y = e.nativeEvent.contentOffset.y;
    const dy = y - lastScrollY.current;
    if (Math.abs(dy) < 20) return;
    collapse.value = withTiming(dy > 0 && y > 150 ? 1 : 0, { duration: 200 });
    lastScrollY.current = y;
  };

  // Never leave the composer collapsed while the keyboard is up (typing).
  useEffect(() => {
    if (keyboardShown) collapse.value = 0;
  }, [keyboardShown, collapse]);

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

  // Open a past chat when one is tapped in the drawer: load its messages and
  // adopt its conversation id so new turns append to it.
  useEffect(() => {
    if (!openId) return;
    let active = true;
    void (async () => {
      try {
        const stored = await loadConversationMessages(openId);
        if (!active) return;
        abortRef.current?.abort();
        setSending(false);
        conversationIdRef.current = openId;
        setMessages(
          stored.map((m) =>
            m.role === "user"
              ? { id: m.id, role: "user" as const, text: m.content }
              : {
                  id: m.id,
                  role: "assistant" as const,
                  mode: m.mode || "Detailed Mode",
                  text: m.content,
                  sources: m.sources,
                  streaming: false,
                },
          ),
        );
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 120);
      } catch (e) {
        Alert.alert("Couldn't open chat", e instanceof Error ? e.message : "Try again.");
      } finally {
        if (active) clearOpen();
      }
    })();
    return () => {
      active = false;
    };
  }, [openId, clearOpen]);

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

  // Tapping a dotted-underlined key term opens a quick web-grounded lookup sheet.
  const handleTermPress = useCallback(
    (term: string) => {
      if (!profile) return;
      Keyboard.dismiss();
      present((close) => <TermLookupSheet term={term} profile={profile} close={close} />);
    },
    [present, profile],
  );

  const scrollToEnd = () =>
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

  // Persist the user's turn (creating the conversation on the first message).
  // Returns the conversation id so the assistant's answer can be saved to it.
  const persistUserTurn = async (text: string): Promise<string | null> => {
    try {
      let cid = conversationIdRef.current;
      if (!cid) {
        cid = await createConversation(deriveTitle(text));
        conversationIdRef.current = cid;
      }
      await saveMessage({ conversationId: cid, role: "user", content: text, mode });
      return cid;
    } catch (err) {
      console.warn("[chat] failed to save user message", err);
      return conversationIdRef.current;
    }
  };

  // Runs one full Q&A turn for an arbitrary prompt — the composer's draft, or a
  // highlight-and-explain follow-up — streaming the answer into a new message.
  const runTurn = async (text: string) => {
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
      {
        id: assistantId,
        role: "assistant",
        mode: `${mode} Mode`,
        text: "",
        sources: [],
        streaming: true,
      },
    ]);
    setSending(true);
    scrollToEnd();

    // Kick off persistence in parallel (creates the conversation on first msg).
    const cidPromise = persistUserTurn(text);

    const controller = new AbortController();
    abortRef.current = controller;

    const patch = (
      fn: (m: Extract<Msg, { role: "assistant" }>) => Extract<Msg, { role: "assistant" }>,
    ) =>
      setMessages((cur) =>
        cur.map((m) => (m.id === assistantId && m.role === "assistant" ? fn(m) : m)),
      );

    // Retrieve grounding excerpts before streaming. Attached files scope the
    // search; otherwise we search the whole library, skipping casual greetings.
    const manuallySelected = selectedDocIds.length > 0;
    let documents: Awaited<ReturnType<typeof retrieveChatContext>> = [];
    if (manuallySelected || !looksCasualMessage(text)) {
      const recentText = messages
        .slice(-6)
        .map((m) => m.text)
        .join(" ");
      documents = await retrieveChatContext(text, selectedDocIds, recentText);
    }
    const documentMode: DocumentMode = manuallySelected
      ? "selected"
      : documents.length > 0
        ? "smart"
        : "none";

    // Accumulate the final answer for persistence (state updates are async, so
    // we can't read the message back synchronously after the stream).
    let finalText = "";
    const finalSources: WebSource[] = [];

    // No file attached (whether or not the library auto-matched): tell the user
    // to add one, then let the AI answer right below the tip. Skip pure greetings.
    if (!manuallySelected && !looksCasualMessage(text)) {
      finalText = ATTACH_TIP;
      patch((m) => ({ ...m, text: ATTACH_TIP }));
    }

    await streamChat({
      messages: history,
      profile,
      mode,
      documents,
      documentMode,
      signal: controller.signal,
      onDelta: (chunk) => {
        finalText += chunk;
        patch((m) => ({ ...m, text: m.text + chunk }));
      },
      onSources: (sources) =>
        patch((m) => {
          const merged = [...m.sources];
          for (const s of sources) {
            if (s.url && !merged.some((x) => x.url === s.url)) merged.push(s);
          }
          const capped = merged.slice(0, 6);
          finalSources.splice(0, finalSources.length, ...capped);
          return { ...m, sources: capped };
        }),
      onError: (message) =>
        patch((m) => ({ ...m, text: m.text || `⚠️ ${message}`, streaming: false })),
      onDone: () => patch((m) => ({ ...m, streaming: false })),
    });

    setSending(false);
    abortRef.current = null;
    scrollToEnd();

    // Persist the assistant's answer and float the conversation to the top.
    const cid = await cidPromise;
    if (cid && finalText.trim()) {
      void saveMessage({
        conversationId: cid,
        role: "assistant",
        content: finalText,
        mode,
        sources: finalSources,
      }).catch((err) => console.warn("[chat] failed to save assistant message", err));
      void touchConversation(cid).catch(() => {});
    }
  };

  const send = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft("");
    void runTurn(text);
  };

  const stopStreaming = () => {
    haptics.light();
    abortRef.current?.abort();
  };

  const newChat = () => {
    haptics.light();
    abortRef.current?.abort();
    setSending(false);
    setMessages([]);
    conversationIdRef.current = null;
  };

  return (
    <MainTabContainer swipeEnabled={false}>
      <TopBar
        onMenu={open}
        right={
          <Pressable hitSlop={10} onPress={newChat} style={styles.topBtn}>
            <Plus size={20} color={colors.text} />
          </Pressable>
        }
      />

      {/* Lift the column so the composer sits flush on the keyboard. Nothing
          above this screen applies a bottom safe-area inset (root and (app)
          layouts are plain flex:1 Views), so this column reaches the true
          screen bottom — the same edge iOS measures the keyboard from. Lift by
          the FULL reported height; subtracting insets.bottom here (unlike the
          modal sheets, which pad their content by insets.bottom to compensate)
          left the composer's bottom edge underneath the keyboard. */}
      <View style={{ flex: 1, marginBottom: keyboardHeight }}>
        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          onScroll={onListScroll}
          scrollEventThrottle={16}
          onContentSizeChange={() => {
            // Keep the newest content in view as an answer streams in.
            if (sending) scrollRef.current?.scrollToEnd({ animated: false });
          }}
        >
          {messages.map((m) =>
            m.role === "user" ? (
              <View key={m.id} style={styles.userBubble}>
                <Text style={styles.userText}>{m.text}</Text>
              </View>
            ) : (
              <View key={m.id} style={styles.assistantBubble}>
                <View style={styles.assistantHead}>
                  <SymbioteOrb size={14} />
                  <Eyebrow>{`Assistant · ${m.mode}`}</Eyebrow>
                  {m.streaming ? (
                    <ActivityIndicator
                      size="small"
                      color={colors.mutedDim}
                      style={{ marginLeft: 2 }}
                    />
                  ) : null}
                </View>
                {m.text ? (
                  <Markdown
                    content={m.text}
                    terms={m.streaming ? undefined : detectKeyTerms(m.text)}
                    onTermPress={handleTermPress}
                    selectable={!m.streaming}
                  />
                ) : m.streaming ? (
                  <Text style={[styles.assistantText, { color: colors.mutedDim }]}>Thinking…</Text>
                ) : null}
                {m.sources.length > 0 ? <ChatSources sources={m.sources} /> : null}
              </View>
            ),
          )}
          {messages.length === 0 ? (
            <View style={styles.emptyChat}>
              <SymbioteOrb size={44} />
              <Text style={styles.emptyTitle}>Ask anything about your material</Text>
              <Text style={styles.emptySub}>
                Answers are grounded in your loaded documents with page-level citations.
              </Text>
            </View>
          ) : null}
        </ScrollView>

        <Animated.View style={[styles.footerAnim, footerAnimStyle]}>
          <View
            onLayout={(e) => {
              const h = e.nativeEvent.layout.height;
              // Capture the natural (keyboard-down, expanded) height to animate from.
              if (!keyboardShown && collapse.value === 0) setFooterH(h);
            }}
            style={[
              styles.footer,
              { paddingBottom: keyboardShown ? 4 : BOTTOM_NAV_HEIGHT + insets.bottom + 8 },
            ]}
          >
            <ModeSelector value={mode} onChange={setMode} />

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
                onPress={sending ? stopStreaming : send}
                disabled={!sending && draft.trim().length === 0}
                style={[styles.sendBtn, !sending && draft.trim().length === 0 && { opacity: 0.5 }]}
              >
                {sending ? (
                  <Square size={15} color={colors.primaryFg} fill={colors.primaryFg} />
                ) : (
                  <Send size={18} color={colors.primaryFg} />
                )}
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </View>
    </MainTabContainer>
  );
}

// The four answer styles, with an indicator pill that slides to the active one
// instead of a hard colour swap. The row measures itself so the segment width
// (and the slide distance) stays correct on any device width.
function ModeSelector({ value, onChange }: { value: ChatMode; onChange: (m: ChatMode) => void }) {
  const haptics = useHaptics();
  const [rowWidth, setRowWidth] = useState(0);
  const gap = 6;
  const seg = rowWidth > 0 ? (rowWidth - gap * (MODES.length - 1)) / MODES.length : 0;
  const index = Math.max(0, MODES.indexOf(value));
  const x = useSharedValue(0);

  useEffect(() => {
    x.value = withTiming(index * (seg + gap), {
      duration: 240,
      easing: Easing.out(Easing.cubic),
    });
  }, [index, seg, x]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
    width: seg,
  }));

  return (
    <View style={styles.modeRow} onLayout={(e) => setRowWidth(e.nativeEvent.layout.width)}>
      {seg > 0 ? <Animated.View style={[styles.modeIndicator, indicatorStyle]} /> : null}
      {MODES.map((mm) => {
        const active = mm === value;
        return (
          <Pressable
            key={mm}
            onPress={() => {
              haptics.selection();
              onChange(mm);
            }}
            style={styles.modeChip}
          >
            <Text
              style={[styles.modeLabel, { color: active ? colors.primaryFg : colors.mutedDim }]}
            >
              {mm}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Renders the web sources under an answer: up to 3 og:image preview thumbnails,
// then a row of tappable favicon chips (host name). Everything opens in the
// system browser. Mirrors the web app's WebSourceIcons.
function ChatSources({ sources }: { sources: WebSource[] }) {
  const shown = sources.slice(0, 6);
  const withImages = shown.filter((s) => s.image).slice(0, 3);
  return (
    <View style={styles.sources}>
      {withImages.length > 0 ? (
        <View style={styles.thumbRow}>
          {withImages.map((s, i) => (
            <SourceThumb key={`thumb-${s.url}-${i}`} source={s} />
          ))}
        </View>
      ) : null}
      <View style={styles.faviconRow}>
        {shown.map((s, i) => (
          <Pressable
            key={`${s.url}-${i}`}
            onPress={() => void Linking.openURL(s.url)}
            style={({ pressed }) => [styles.sourceChip, pressed && { opacity: 0.6 }]}
          >
            <SourceFavicon url={s.url} />
            <Text style={styles.sourceChipText} numberOfLines={1}>
              {hostFromUrl(s.url) || s.title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// og:image preview; on load failure it removes itself (the favicon chip below
// still represents the source).
function SourceThumb({ source }: { source: WebSource }) {
  const [failed, setFailed] = useState(false);
  if (failed || !source.image) return null;
  return (
    <Pressable onPress={() => void Linking.openURL(source.url)} style={styles.thumb}>
      <Image
        source={{ uri: source.image }}
        style={styles.thumbImg}
        onError={() => setFailed(true)}
        resizeMode="cover"
      />
    </Pressable>
  );
}

function SourceFavicon({ url }: { url: string }) {
  const host = hostFromUrl(url);
  const [failed, setFailed] = useState(false);
  if (!host || failed) return <Globe size={12} color={colors.mutedDim} />;
  return (
    <Image
      source={{ uri: `https://www.google.com/s2/favicons?domain=${host}&sz=64` }}
      style={styles.favicon}
      onError={() => setFailed(true)}
    />
  );
}

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
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
    paddingBottom: 28,
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
    fontSize: 16.5,
    lineHeight: 24,
  },
  assistantBubble: {
    alignSelf: "stretch",
    maxWidth: "100%",
    paddingVertical: 2,
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
  sources: {
    gap: 8,
    marginTop: 2,
  },
  thumbRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  thumb: {
    width: 132,
    height: 84,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  thumbImg: {
    width: "100%",
    height: "100%",
  },
  faviconRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sourceChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingLeft: 8,
    paddingRight: 10,
    paddingVertical: 5,
  },
  sourceChipText: {
    flexShrink: 1,
    fontFamily: fonts.mono,
    fontSize: 10.5,
    color: colors.muted,
  },
  favicon: {
    width: 14,
    height: 14,
    borderRadius: 3,
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
  footerAnim: {
    overflow: "hidden",
    backgroundColor: colors.bg,
  },
  footer: {
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 10,
    backgroundColor: colors.bg,
  },
  modeRow: {
    position: "relative",
    flexDirection: "row",
    gap: 6,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    padding: 0,
  },
  modeChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: radius.full,
  },
  modeIndicator: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.full,
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
