import { router, usePathname } from "expo-router";
import {
  BookOpen,
  BrainCircuit,
  Clock,
  Heart,
  LogOut,
  type LucideIcon,
  MessageSquare,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Swords,
  TimerReset,
  Trophy,
  Users,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
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
import { RankBadge, RankProgressBar } from "@/components/rank-badge";
import { BrandText } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { type ConversationSummary, listConversations } from "@/lib/conversations";
import { rankProgress } from "@/lib/ranks";
import { socialEnabled } from "@/lib/social";
import { colors, font, fonts, radius } from "@/lib/theme";
import { useConversation } from "./conversation-context";
import { useDrawer } from "./drawer-context";
import { useDrawerGestures } from "./useDrawerGestures";
import { setPendingDir, tabIndex } from "./tab-transition";

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

// The website groups Recent by age rather than showing a flat capped list
// (see SidebarConvoGroup in src/routes/-app-shell.tsx); the drawer is the only
// chat history the native app has, so it carries the same grouping.
type ConvoGroups = {
  today: ConversationSummary[];
  yesterday: ConversationSummary[];
  thisWeek: ConversationSummary[];
  thisMonth: ConversationSummary[];
  older: ConversationSummary[];
};

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function groupConversations(list: ConversationSummary[]): ConvoGroups {
  const groups: ConvoGroups = { today: [], yesterday: [], thisWeek: [], thisMonth: [], older: [] };
  const todayStart = startOfDay(new Date());
  const day = 86_400_000;
  for (const convo of list) {
    const at = new Date(convo.updated_at).getTime();
    if (!Number.isFinite(at)) {
      groups.older.push(convo);
      continue;
    }
    if (at >= todayStart) groups.today.push(convo);
    else if (at >= todayStart - day) groups.yesterday.push(convo);
    else if (at >= todayStart - 7 * day) groups.thisWeek.push(convo);
    else if (at >= todayStart - 30 * day) groups.thisMonth.push(convo);
    else groups.older.push(convo);
  }
  return groups;
}

/**
 * The side menu — the native counterpart of the website's sidebar, and now the
 * same shape: brand, search, "Study space", "Your work", date-grouped Recent,
 * and an account block that carries the rank, the progress to the next one and
 * the streak. It used to be brand → search → chats → settings, which meant
 * History, Feedback and the whole progression system were unreachable or
 * invisible on a phone.
 */
export function Drawer() {
  const { isOpen, close } = useDrawer();
  const { requestOpen } = useConversation();
  const { gesture, backdropStyle, panelStyle } = useDrawerGestures(WIDTH);
  const insets = useSafeAreaInsets();
  const { signOut, profile, user } = useAuth();
  const pathname = usePathname();
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
  const filtered = useMemo(
    () => (q ? convos.filter((c) => c.title.toLowerCase().includes(q)) : convos),
    [convos, q],
  );
  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  // Points come from the profile row the web app syncs (user_profiles.points),
  // so the rank a student sees on their phone is the same one the leaderboard
  // ranks them by — not a second, local tally that would drift.
  const points = Math.max(0, Math.round(profile?.points ?? 0));
  const progress = rankProgress(points);
  const streak = Math.max(0, Math.round(profile?.current_streak ?? 0));

  // Tab routes swap the current screen; secondary routes push on top of it.
  // The slide direction is taken from where the target tab sits relative to the
  // one on screen, so opening Library from Chat slides the same way tapping it
  // in the bottom bar would.
  const goTab = (route: string) => {
    const from = pathname;
    close();
    setTimeout(() => {
      if (route === from) return;
      setPendingDir(tabIndex(route) > tabIndex(from) ? 1 : -1);
      router.replace(route as never);
    }, 60);
  };

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

  const initial = (profile?.name || "S").slice(0, 1).toUpperCase();
  const subtitle = [profile?.year, profile?.university].filter(Boolean).join(" · ");

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
            { width: WIDTH, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 12 },
            panelStyle,
          ]}
        >
          <View style={styles.brandRow}>
            <BrandText size={24} />
          </View>

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

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.navLabel}>Study space</Text>
            <NavRow icon={MessageSquare} label="Chat" onPress={() => goTab("/chat")} />
            <NavRow icon={BookOpen} label="Library" onPress={() => goTab("/library")} />
            <NavRow icon={BrainCircuit} label="My Coach" onPress={() => goTab("/coach")} />
            {/* Battle Royale took Last Minute's spot in the bottom bar
                (2026-08-13), so it takes its spot here too — same "goTab" as
                the other three main tabs (replace + slide), not "go". */}
            <NavRow icon={Swords} label="Battle Royale" onPress={() => goTab("/battle-royale")} />

            <View style={styles.divider} />
            <Text style={styles.navLabel}>Your work</Text>
            {/* Last Minute moved from a main tab to here. It still works exactly
                as it always has — this only changes where it's reached from, so
                it keeps "go" (push) rather than the main tabs' "goTab". */}
            <NavRow
              icon={TimerReset}
              label="Last Minute"
              // "Last minute" wears its urgency whether or not it is the active
              // row — the same rule the web nav follows.
              iconColor={colors.warning}
              onPress={() => go("/last-minute")}
            />
            <NavRow icon={Clock} label="History" onPress={() => go("/history")} />
            <NavRow icon={Trophy} label="Leaderboard" onPress={() => go("/leaderboard")} />
            {/* Hidden entirely until the social migration is applied — same rule
                as the web sidebar's Friends entry (see socialEnabled()). The
                route still exists; this only decides whether it's advertised. */}
            {socialEnabled(user) && (
              <NavRow icon={Users} label="Friends" onPress={() => go("/friends")} />
            )}
            <NavRow
              icon={Sparkles}
              label="Personalize"
              dot={!profile?.personalization_background}
              onPress={() => go("/settings")}
            />
            <NavRow icon={Heart} label="Feedback" onPress={() => go("/feedback")} />

            <View style={styles.divider} />
            <Text style={styles.navLabel}>Recent</Text>
            {loadingConvos ? (
              <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 16 }} />
            ) : filtered.length === 0 ? (
              <Text style={styles.emptyText}>
                {q
                  ? "No chats match your search."
                  : "Your past chats will appear here once you start a conversation."}
              </Text>
            ) : (
              <>
                <ConvoGroup title="Today" items={groups.today} onOpen={openChat} />
                <ConvoGroup title="Yesterday" items={groups.yesterday} onOpen={openChat} />
                <ConvoGroup title="This week" items={groups.thisWeek} onOpen={openChat} />
                <ConvoGroup title="This month" items={groups.thisMonth} onOpen={openChat} />
                <ConvoGroup title="Older" items={groups.older} onOpen={openChat} />
              </>
            )}
            <View style={{ height: 12 }} />
          </ScrollView>

          {/* The account block: who you are, what rank you hold, how far to the
              next one — then settings and sign out. */}
          <View style={styles.bottom}>
            <View style={styles.profileRow}>
              <View style={styles.profileMark}>
                <Text style={styles.profileMarkText}>{initial}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.profileName} numberOfLines={1}>
                  {profile?.name || "Student"}
                </Text>
                <View style={styles.rankLine}>
                  <RankBadge rank={progress.rank} size="sm" style={{ width: 16, height: 16 }} />
                  <Text style={styles.rankName} numberOfLines={1}>
                    {progress.rank.name}
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => go("/settings")}
                hitSlop={8}
                style={({ pressed }) => [styles.gear, pressed && styles.itemPressed]}
              >
                <Settings size={18} color={colors.muted} />
              </Pressable>
            </View>

            {/* The bar answers "how close am I"; the line answers "to what". */}
            <RankProgressBar percent={progress.percent} style={{ marginTop: 10 }} />
            <Text style={styles.progressMeta} numberOfLines={1}>
              {points.toLocaleString()} pts ·{" "}
              {progress.next
                ? `${progress.pointsToNext.toLocaleString()} to ${progress.next.name}`
                : "top rank"}{" "}
              · {streak}d
            </Text>
            {subtitle ? (
              <Text style={styles.profileMeta} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}

            <Pressable
              onPress={onSignOut}
              style={({ pressed }) => [styles.signOut, pressed && styles.itemPressed]}
            >
              <LogOut size={18} color={colors.danger} />
              <Text style={[styles.itemLabel, { color: colors.danger }]}>Sign out</Text>
            </Pressable>

            {/* Google Play requires both of these reachable from inside the app,
                not just the website — kept small and out of the way since they
                are reference pages, not daily-use nav. */}
            <View style={styles.legalRow}>
              <Pressable onPress={() => go("/privacy")} hitSlop={8}>
                <View style={styles.legalItem}>
                  <ShieldCheck size={13} color={colors.mutedDim} />
                  <Text style={styles.legalText}>Privacy</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => go("/delete-account")} hitSlop={8}>
                <Text style={styles.legalText}>Delete account</Text>
              </Pressable>
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function NavRow({
  icon: Icon,
  label,
  onPress,
  iconColor,
  dot = false,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  iconColor?: string;
  dot?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}>
      <Icon size={18} color={iconColor ?? colors.muted} />
      <Text style={styles.itemLabel} numberOfLines={1}>
        {label}
      </Text>
      {/* An unset personalization background is the one thing the nav nags
          about, and it does it with a dot rather than a word. */}
      {dot ? <View style={styles.dot} /> : null}
    </Pressable>
  );
}

function ConvoGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ConversationSummary[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: 10 }}>
      <Text style={styles.groupLabel}>{title}</Text>
      {items.map((c) => (
        <Pressable
          key={c.id}
          onPress={() => onOpen(c.id)}
          style={({ pressed }) => [styles.chatRow, pressed && styles.itemPressed]}
        >
          <MessageSquare size={15} color={colors.mutedDim} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.chatTitle} numberOfLines={1}>
              {c.title || "New conversation"}
            </Text>
            <Text style={styles.chatTime}>{timeAgo(c.updated_at)}</Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000",
  },
  // The web sidebar is the page ground with a hairline edge, not a lighter
  // slab — but a drawer floats over the app, so this must be OPAQUE.
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    paddingHorizontal: 16,
  },
  brandRow: {
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 18,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchInput: {
    flex: 1,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    padding: 0,
  },
  scroll: {
    flex: 1,
    marginTop: 6,
  },
  navLabel: {
    fontFamily: fonts.bodySemibold,
    fontSize: 10,
    letterSpacing: font.eyebrowLetterSpacing,
    color: colors.muted,
    textTransform: "uppercase",
    marginTop: 16,
    marginBottom: 4,
    paddingHorizontal: 10,
  },
  groupLabel: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    letterSpacing: 1,
    color: colors.mutedDim,
    textTransform: "uppercase",
    paddingHorizontal: 10,
    marginBottom: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginTop: 14,
    marginHorizontal: 4,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  itemPressed: {
    backgroundColor: colors.tintStrong,
  },
  itemLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14.5,
    color: colors.text,
    flex: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
  },
  emptyText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.mutedDim,
    lineHeight: 19,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
  },
  chatTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  chatTime: {
    fontFamily: fonts.mono,
    fontSize: 9.5,
    color: colors.mutedDim,
    marginTop: 2,
  },
  bottom: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 12,
    paddingHorizontal: 4,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  profileMark: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  profileMarkText: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: colors.primaryFg,
  },
  profileName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  rankLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
  },
  rankName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.text,
    flex: 1,
  },
  gear: {
    padding: 6,
    borderRadius: radius.sm,
  },
  progressMeta: {
    fontFamily: fonts.mono,
    fontSize: 10,
    color: colors.muted,
    marginTop: 5,
  },
  profileMeta: {
    fontFamily: fonts.body,
    fontSize: 11.5,
    color: colors.mutedDim,
    marginTop: 3,
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 6,
    marginTop: 8,
    borderRadius: radius.sm,
  },
  legalRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingHorizontal: 6,
    paddingTop: 10,
  },
  legalItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  legalText: {
    fontFamily: fonts.body,
    fontSize: 11,
    color: colors.mutedDim,
  },
});
