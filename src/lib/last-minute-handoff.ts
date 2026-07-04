const KEY_PREFIX = "gd-last-minute-master-note";

export type LastMinuteHandoff = {
  title: string;
  note: string;
  docIds: string[];
  createdAt: number;
};

function key(userId: string) {
  return `${KEY_PREFIX}:${userId}`;
}

export function stageLastMinuteForCoach(userId: string, handoff: LastMinuteHandoff): void {
  try {
    window.localStorage.setItem(key(userId), JSON.stringify(handoff));
  } catch {
    // Best effort. If localStorage is unavailable, the user can still copy/download the note.
  }
}

export function takeLastMinuteForCoach(userId: string): LastMinuteHandoff | null {
  try {
    const raw = window.localStorage.getItem(key(userId));
    if (!raw) return null;
    window.localStorage.removeItem(key(userId));
    const parsed = JSON.parse(raw) as LastMinuteHandoff;
    if (!parsed?.note) return null;
    return parsed;
  } catch {
    return null;
  }
}
