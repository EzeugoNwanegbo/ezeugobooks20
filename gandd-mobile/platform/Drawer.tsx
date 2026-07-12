import { router } from "expo-router";
import { LogOut, MessageSquare, Search, Settings } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BrandText } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { type ConversationSummary, listConversations } from "@/lib/conversations";
import { colors, fonts, radius } from "@/lib/theme";
import { useConversation } from "./conversation-context";
import { useDrawer } from "./drawer-context";
import { useDrawerGestures } from "./useDrawerGestures";

export const DRAWER_WIDTH = 304;
const WIDTH = DRAWER_WIDTH;

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Overlay drawer: logo → search → past chats → (Settings + Sign out) pinned at
// the bottom. Conversations load each time the drawer opens so the list is
// always fresh, and tapping one hands its id to the chat screen to reopen.
export function Drawer() {
  const { isOpen, close } = useDrawer();
  const { requestOpen } = useConversation();
  const { gesture, backdropStyle, panelStyle } = useDrawerGestures(WIDTH);
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const [query, setQuery] = useState("");
  const [convos, setConvos] = useState<ConversationSummary[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoadingConvos(true);
    listConversations()
      .then((list) => {
        if (active) setConvos(list);
      })
      .catch(() => {
        /* leave the list empty on failure */
      })
      .finally(() => {
        if (active) setLoadingConvos(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  const q = query.trim().toLowerCase();
  const filtered = q ? convos.filter((c) => c.title.toLowerCase().includes(q)) : convos;

  const go = (route: string) => {
    close();
    setTimeout(() => router.push(route as never), 60);
  };

  const openChat = (id: string) => {
    requestOpen(id);
    close();
    setTimeout(() => router.replace("/chat" as never), 60);
  };

  const onSignOut = () => {
    close();
    setTimeout(() => void signOut(), 60);
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={isOpen ? "auto" : "none"}>
      <AnimatedPressable
        style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}
        onPress={close}
      />
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.panel,
            { width: WIDTH, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 16 },
            panelStyle,
          ]}
        >
          <BrandText size={26} />

          {/* Search past chats */}
          <View style={styles.search}>
            <Search size={16} color={colors.mutedDim} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search chats"
              placeholderTextColor={colors.mutedDim}
              style={styles.searchInput}
            />
          </View>

          {/* Past chats */}
          <Text style={styles.sectionLabel}>Recent chats</Text>
          <ScrollView
            style={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {loadingConvos ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 20 }} />
            ) : filtered.length === 0 ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>
                  {q
                    ? "No chats match your search."
                    : "Your past chats will appear here once you start a conversation."}
                </Text>
              </View>
            ) : (
              filtered.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => openChat(c.id)}
                  style={({ pressed }) => [styles.chatRow, pressed && styles.itemPressed]}
                >
                  <MessageSquare size={16} color={colors.mutedDim} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.chatTitle} numberOfLines={1}>
                      {c.title || "New conversation"}
                    </Text>
                    <Text style={styles.chatTime}>{timeAgo(c.updated_at)}</Text>
                  </View>
                </Pressable>
              ))
            )}
          </ScrollView>

          {/* Bottom: Settings + Sign out */}
          <View style={styles.bottom}>
            <Pressable
              onPress={() => go("/settings")}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              <Settings size={20} color={colors.muted} />
              <Text style={styles.itemLabel}>Settings</Text>
            </Pressable>
            <Pressable
              onPress={onSignOut}
              style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            >
              <LogOut size={20} color={colors.danger} />
              <Text style={[styles.itemLabel, { color: colors.danger }]}>Sign out</Text>
            </Pressable>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000",
  },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceLowest,
    borderTopRightRadius: radius.xl,
    borderBottomRightRadius: radius.xl,
    paddingHorizontal: 20,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 22,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    padding: 0,
  },
  sectionLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.mutedDim,
    textTransform: "uppercase",
    marginTop: 22,
    marginBottom: 6,
  },
  list: {
    flex: 1,
  },
  empty: {
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radius.md,
  },
  chatTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14.5,
    color: colors.text,
  },
  chatTime: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.mutedDim,
    marginTop: 2,
  },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 10,
    gap: 2,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: radius.full,
  },
  itemPressed: {
    backgroundColor: colors.tint,
  },
  itemLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
  },
});
