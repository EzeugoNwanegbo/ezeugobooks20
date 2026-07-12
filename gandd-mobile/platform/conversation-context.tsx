// Bridges the drawer (where a past chat is tapped) to the chat screen (which
// loads it). The chat screen stays mounted as a tab, so a plain callback prop
// won't reach it — this shared context does.

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

type ConversationContextValue = {
  // Conversation id the chat screen should open, or null once consumed.
  openId: string | null;
  requestOpen: (id: string) => void;
  clearOpen: () => void;
};

const ConversationContext = createContext<ConversationContextValue | null>(null);

export function ConversationProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const requestOpen = useCallback((id: string) => setOpenId(id), []);
  const clearOpen = useCallback(() => setOpenId(null), []);
  const value = useMemo(
    () => ({ openId, requestOpen, clearOpen }),
    [openId, requestOpen, clearOpen],
  );
  return <ConversationContext.Provider value={value}>{children}</ConversationContext.Provider>;
}

export function useConversation() {
  const ctx = useContext(ConversationContext);
  if (!ctx) throw new Error("useConversation must be used within a ConversationProvider");
  return ctx;
}
