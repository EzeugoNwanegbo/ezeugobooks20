// "Once in a lifetime" first-run flags: the guided tour and the per-page
// intros, shown to an ACCOUNT once and never again.
//
// WHY THIS EXISTS. Every one of those flags used to live in localStorage,
// keyed per user id. That is once per BROWSER, not once per person: a student
// who cleared their cache, opened the app on a laptop after their phone, or
// used a private window met the tour and every intro paragraph again. The
// owner's rule is once in a lifetime, so the flag has to live where the account
// lives.
//
// HOW IT WORKS. The truth is `user_profiles.seen_intros`, a text[] the student
// owns under the existing own-row RLS. localStorage stays as a cache in front
// of it, so every existing synchronous `hasSeen…()` reader keeps working
// unchanged - priming copies the server's list into those same keys before the
// UI asks. Marking writes both.
//
// Detection, not a flag: the column may not exist yet, and per
// detect-migrations-not-flags this asks rather than reading a constant someone
// has to remember to flip. A missing column latches `columnMissing` and the
// whole module degrades to exactly the localStorage behaviour it replaced.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/** Every first-run surface, by the token stored in the database. */
export type OnceKey = "tour" | "library" | "friends";

/**
 * The localStorage key each surface already used, so priming writes the flag
 * the existing readers look for. Changing one of these strings re-shows that
 * surface to everyone whose browser cached it, which is why they are copied
 * verbatim from the modules that own them rather than tidied.
 */
const LOCAL_BASE: Record<OnceKey, string> = {
  tour: "gd_feature_tour_seen_v1",
  library: "gd_library_intro_seen_v1",
  friends: "gd_friends_intro_seen_v1",
};

// The generated Database type does not know about seen_intros, so calling it
// through the typed client would not compile. Same narrow escape hatch as
// src/lib/social.ts and src/lib/school.ts.
type Row = { seen_intros: string[] | null };
type OnceDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: Row | null;
          error: { code?: string; message?: string } | null;
        }>;
      };
    };
    update: (values: Record<string, unknown>) => {
      eq: (
        column: string,
        value: string,
      ) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
};
const db = supabase as unknown as OnceDb;

/**
 * Latched when the database has no seen_intros column.
 *
 * Only a MISSING COLUMN latches it. PostgREST answers that with 42703 or
 * PGRST204; a network failure must not latch, or one bad moment would demote
 * the whole feature to per-browser for the rest of the session.
 */
let columnMissing = false;

function isMissingColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return (
    /seen_intros/.test(error.message ?? "") && /does not exist|column/i.test(error.message ?? "")
  );
}

function localKey(key: OnceKey, userId: string): string {
  return `${LOCAL_BASE[key]}:${userId}`;
}

/** Blocked storage counts as "already seen" - the same rule every caller uses. */
export function hasSeenLocally(key: OnceKey, userId: string | null | undefined): boolean {
  if (!userId) return true;
  try {
    return window.localStorage.getItem(localKey(key, userId)) === "1";
  } catch {
    return true;
  }
}

function setSeenLocally(key: OnceKey, userId: string): void {
  try {
    window.localStorage.setItem(localKey(key, userId), "1");
  } catch {
    // Nothing to do - worst case the surface introduces itself once more.
  }
}

/** One in-flight prime per user, so several callers share a single request. */
const priming = new Map<string, Promise<void>>();

/**
 * Copy the account's seen list into this browser's cache.
 *
 * Safe to call from as many places as want it: the promise is shared, and the
 * result only ever ADDS flags. It never clears one, because a browser that has
 * seen something is a fact the server cannot contradict - the student did see
 * it here, whatever the account row says.
 */
export function primeSeenOnce(userId: string | null | undefined): Promise<void> {
  if (!userId || userId === "guest" || columnMissing) return Promise.resolve();
  const existing = priming.get(userId);
  if (existing) return existing;

  const run = (async () => {
    try {
      const { data, error } = await db
        .from("user_profiles")
        .select("seen_intros")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        if (isMissingColumn(error)) columnMissing = true;
        return;
      }
      for (const token of data?.seen_intros ?? []) {
        if (token in LOCAL_BASE) setSeenLocally(token as OnceKey, userId);
      }
    } catch {
      // Never throws. A first-run flag failing to load is not a reason to
      // break the shell that called it.
    }
  })();

  priming.set(userId, run);
  return run;
}

/**
 * Bank a surface as seen, in this browser and on the account.
 *
 * The local write is synchronous and happens first so the caller's own
 * `hasSeen…()` is correct on the very next line; the server write is
 * best-effort and never awaited by the UI.
 */
export function markSeenOnce(key: OnceKey, userId: string | null | undefined): void {
  if (!userId || userId === "guest") return;
  setSeenLocally(key, userId);
  if (columnMissing) return;

  void (async () => {
    try {
      const { data, error } = await db
        .from("user_profiles")
        .select("seen_intros")
        .eq("id", userId)
        .maybeSingle();
      if (error) {
        if (isMissingColumn(error)) columnMissing = true;
        return;
      }
      const current = data?.seen_intros ?? [];
      if (current.includes(key)) return;
      const { error: updateError } = await db
        .from("user_profiles")
        .update({ seen_intros: [...current, key] })
        .eq("id", userId);
      if (updateError && isMissingColumn(updateError)) columnMissing = true;
    } catch {
      // Best effort. The local flag already stopped it re-showing here.
    }
  })();
}

/**
 * Should this surface introduce itself?
 *
 * Returns "unknown" until the account's list has been consulted, and callers
 * MUST render nothing in that state. Defaulting to "show" would flash an
 * explanatory paragraph at a returning student for exactly as long as the query
 * takes - the precise thing this module exists to stop.
 */
export function useSeenOnce(
  key: OnceKey,
  userId: string | null | undefined,
): "unknown" | "seen" | "unseen" {
  const [state, setState] = useState<"unknown" | "seen" | "unseen">(() =>
    hasSeenLocally(key, userId) ? "seen" : "unknown",
  );

  useEffect(() => {
    if (!userId) {
      setState("seen");
      return;
    }
    if (hasSeenLocally(key, userId)) {
      setState("seen");
      return;
    }
    let active = true;
    void primeSeenOnce(userId).then(() => {
      if (!active) return;
      setState(hasSeenLocally(key, userId) ? "seen" : "unseen");
    });
    return () => {
      active = false;
    };
  }, [key, userId]);

  return state;
}
