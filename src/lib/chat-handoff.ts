// Lightweight handoff for "upload a file, then start chatting about it".
// The Library page stages the freshly-uploaded document id here, then navigates
// to the chat. The chat page picks it up on mount, pre-selects the document as
// the search context, and clears the handoff. localStorage (not a query param)
// keeps the chat URL clean and survives the lazy route mount.

const PENDING_DOC_PREFIX = "gd-chat-pending-doc";

function key(userId: string) {
  return `${PENDING_DOC_PREFIX}:${userId}`;
}

/** Remember which document the user just uploaded so chat can attach it. */
export function stageDocForChat(userId: string, docId: string): void {
  try {
    window.localStorage.setItem(key(userId), docId);
  } catch {
    // localStorage can be unavailable in some embedded webviews - best effort.
  }
}

/** Read and clear the pending document id, if any. */
export function takePendingChatDoc(userId: string): string | null {
  try {
    const value = window.localStorage.getItem(key(userId));
    if (value) window.localStorage.removeItem(key(userId));
    return value || null;
  } catch {
    return null;
  }
}
