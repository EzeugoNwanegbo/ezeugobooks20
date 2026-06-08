// Tiny stale-while-revalidate cache for list data.
//
// It lives in memory for the single-page-app session (and is wiped on a real
// browser reload), so moving between pages shows the last-known data instantly
// instead of a loading spinner, while a fresh fetch quietly updates it. Keep
// keys user-scoped so one account never sees another's cached data.
const store = new Map<string, unknown>();

export function getCached<T>(key: string): T | undefined {
  return store.get(key) as T | undefined;
}

export function setCached<T>(key: string, value: T): void {
  store.set(key, value);
}

export function clearCached(key: string): void {
  store.delete(key);
}

export function clearAllCached(): void {
  store.clear();
}
