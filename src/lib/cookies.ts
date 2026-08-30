// Cookies: a daily AI budget a student cannot edit.
//
// ── WHY THIS FILE EXISTS, AND WHY IT LOOKS LIKE seen-once.ts / content-hash.ts
// ────────────────────────────────────────────────────────────────────────────
// The schema this depends on - cookie_spends, cookie_grants, cookie_balance(),
// spend_cookies(), spend_cookies_for(), refund_cookie_spend() - is applied BY
// HAND, from supabase/migrations/20260824130000_cookies_daily_budget.sql (also
// bundled as PART 5 of supabase/APPLY-PENDING.sql). Naming a function
// PostgREST does not have makes it reject the whole call, which took uploads
// down in production once already - see detect-migrations-not-flags. So
// nothing here reads a hand-flipped constant; it ASKS, the way
// src/lib/content-hash.ts's primeDedupSchema() and src/lib/seen-once.ts's
// columnMissing latch already do. The first cookie_balance() call each session
// answers the question once; a missing-function error (PGRST202) latches
// `schemaState = "absent"` for the rest of the session, and every exported
// reader below degrades to "there is no meter" rather than a wrong one.
//
// ONLY TWO CALLS ARE ALLOWED TO LATCH IT: cookie_balance(), which IS the
// meter's read, and spend_cookies(), the client-side charge. The latch is
// process-wide and sticky, so one of the admin-screen readers at the bottom of
// this file latching it would take the meter away from a normal student for the
// rest of their session over a question the meter does not depend on - an
// admin-only RPC they are not entitled to call, or a grant table they cannot
// see. Those readers therefore return null on any error and latch nothing;
// each one says so at its own definition.
//
// ── FAILS OPEN. THIS FILE NEVER BLOCKS ANYTHING ─────────────────────────────
// Every function here is a READ (the balance, for the ring) or a CLIENT-SIDE
// CHARGE (spendCookiesClientSide, whose only caller - Battle Royale - is
// priced at 0 today, so in practice this file is all reads). The functions that
// can actually refuse a student - chat, studybody, last-minute - charge
// SERVER-SIDE, inside their own Edge Functions, with their own copy of this
// exact fail-open contract written out in full (see the header comment above
// chargeCookies() in supabase/functions/chat/index.ts). Nothing in THIS module
// ever turns a missing function or a network error into a refusal; the worst
// outcome anything here produces is "unavailable" - the ring does not render,
// and the caller who asked proceeds exactly as if cookies did not exist yet.
//
// ── THE PRICE LIST LIVES HERE, ONCE ─────────────────────────────────────────
// COOKIE_COSTS below is the one editable copy. Edge Functions cannot import
// this file - they are separate Deno deploys, this is browser code that pulls
// in the browser Supabase client and import.meta.env - so each of
// supabase/functions/{chat,studybody,last-minute}/index.ts repeats only its
// own price, with a comment pointing back here. If the numbers are ever found
// to disagree, the Edge Function's copy is what is actually being billed, so
// fix this file to match it, not the other way round.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── The price list ───────────────────────────────────────────────────────────
//
// Chat at 1 is the number the daily budget of 15 is built around: 15 chat
// messages, or a full 40-question set (4) and eleven messages, or two Last
// Minutes (2 each) and eleven. Every price here was halved-or-better when the
// allowance came down from the 30-60 earned ladder to a flat 15 - see
// supabase/migrations/20260829120000_cookie_budget_15.sql, which carries the
// whole decision, and docs/cookies-and-milestones-plan.md for the reasoning
// behind the shape. The numbers themselves are not up for renegotiation here.
export type CookieAction =
  | "chat"
  | "generate_questions"
  | "generate_flashcards"
  | "generate_plan"
  | "last_minute"
  | "battle_royale"
  | "review_answers";

export const COOKIE_COSTS: Record<CookieAction, number | ((count: number) => number)> = {
  chat: 1,
  // ceil(count / 10), minimum 1 - a 40-question set is 4.
  generate_questions: (count) => Math.max(1, Math.ceil((count || 0) / 10)),
  // ceil(count / 20), minimum 1 - a 20-card set is 1.
  generate_flashcards: (count) => Math.max(1, Math.ceil((count || 0) / 20)),
  generate_plan: 2,
  last_minute: 2,
  // ZERO, AND NOT BECAUSE A BATTLE IS FREE. Read this before changing it back.
  //
  // This entry used to be 2, charged client-side by src/lib/battle-royale-client.ts
  // "once per match", on the stated belief that the rounds underneath it were
  // not billed anywhere else. That belief was wrong. A battle is built by
  // createStraightInSession() (src/lib/studybody-data.ts), which calls
  // generateStudyQuestions() -> the studybody Edge Function -> its own
  // chargeCookies(..., "generate_questions", ...). That charge is server-side
  // and unconditional: it does not know, and cannot be told, that this
  // particular question set is a battle round. So every match was being billed
  // TWICE - a flat 2 here plus ceil(n/10) per round there. A six-round roadmap
  // series cost 8 of a 15-cookie day instead of the 2 it was priced at.
  //
  // WHY THE SERVER-SIDE HALF IS THE ONE THAT SURVIVED. The obvious fix is the
  // other one: keep the flat 2 and have battle-royale-client tell studybody
  // "don't charge, this is a battle". That is a flag the browser asserts, and
  // this whole subsystem exists because browser-asserted numbers are worthless -
  // see the "COOKIES DEFEND A BILL" section at the head of
  // supabase/migrations/20260824130000_cookies_daily_budget.sql. Anyone who
  // opened dev tools could send that flag on an ordinary Practice Questions
  // request and generate for free forever. A double charge is a bug; a
  // client-settable "bill me nothing" is a hole, and holes are worse.
  //
  // So a battle now costs exactly what the AI work under it costs: ceil(n/10)
  // per round, charged by studybody where it cannot be forged. A single
  // ten-question match is 1; a six-round roadmap series is 6.
  //
  // TO GO BACK TO A FLAT FEE PER MATCH, this number is the only thing to
  // change - chargeBattleCookie() in battle-royale-client.ts is still wired up
  // and simply no-ops at 0 - but a flat fee is only honest once a battle is
  // built by an Edge Function that can charge for the whole match itself,
  // rather than by the browser calling studybody N times.
  battle_royale: 0,
  // Marking already-generated answers. The set already paid for itself when
  // it was generated; charging again here would be paying twice for one AI
  // action split across two requests.
  review_answers: 0,
};

/** `count` is ignored by every flat-rate action; only the two generators read it. */
export function costFor(action: CookieAction, count = 1): number {
  const price = COOKIE_COSTS[action];
  return typeof price === "function" ? price(count) : price;
}

// ── Schema detection ─────────────────────────────────────────────────────────
//
// "unknown" until the first real call answers; every reader treats "unknown"
// exactly like "absent" until told otherwise, which is the direction that can
// never show a wrong number.
let schemaState: "unknown" | "ready" | "absent" = "unknown";
/** The last balance a successful read produced, shared across every mounted useCookies(). */
let cachedBalance: CookieBalance | null = null;
/**
 * Whose balance cachedBalance is.
 *
 * cookie_balance() reads auth.uid(), so the number it returns belongs to one
 * account and nobody else - but the cache holding it is a module global that
 * outlives any particular session. Sign out and sign back in as somebody else
 * in the same tab (which is exactly what happens on a shared laptop, and what
 * the owner does every time they check a student's account) and every ring
 * would paint the PREVIOUS student's remaining count, from cache, for up to
 * BALANCE_FRESH_MS - a wrong meter, which is the one thing this file is not
 * allowed to produce. Stamping the cache with its owner makes that
 * impossible: a different id simply misses the cache and reads fresh.
 */
let cachedBalanceUserId: string | null = null;
/**
 * When cachedBalance was last filled from the server.
 *
 * The meter now renders in three places at once - the sidebar, the mobile
 * topbar and every PageHeader - and each is its own useCookies(). Without this,
 * every page navigation would fire one cookie_balance() per mounted ring for a
 * number that had not moved. A short window is enough: anything that actually
 * CHANGES the balance already announces itself on COOKIES_CHANGED_EVENT and
 * refetches, so this only ever suppresses a re-read of a value nothing touched.
 *
 * It never suppresses a settle: reportCookiesSettled() goes through refetch(),
 * which calls fetchBalance() directly rather than consulting this window. The
 * freshness check lives in the MOUNT effect only, which is the only place that
 * can ask for a number nothing has touched.
 */
let lastFetchedAt = 0;
const BALANCE_FRESH_MS = 30_000;

/** True when the shared cache holds a number that belongs to this user and is still inside the freshness window. */
function cacheIsUsableFor(userId: string): boolean {
  return (
    cachedBalance != null &&
    cachedBalanceUserId === userId &&
    Date.now() - lastFetchedAt < BALANCE_FRESH_MS
  );
}

// A function call, not a bare variable read: TypeScript's control-flow
// analysis narrows a re-assignable `let` across an `await` using whatever it
// last proved true SYNTACTICALLY, even when the awaited call (fetchBalance(),
// here) is exactly what reassigns it - so a direct `schemaState === "absent"`
// re-check right after such an await is flagged as unreachable when an
// earlier check in the same function already ruled it out. Reading through a
// same-file function call sidesteps that: the return type is this function's
// declared union, not a narrowing carried over from the caller's flow.
function currentSchemaState(): "unknown" | "ready" | "absent" {
  return schemaState;
}

function isMissingFunction(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

// The generated Database type does not know about these RPCs/tables, so
// calling them through the typed client would not compile. Same narrow escape
// hatch as src/lib/social.ts and src/lib/seen-once.ts - typed to exactly the
// shapes this file calls, nothing more.
type PgError = { message: string; code?: string } | null;
type RpcResult = { data: unknown; error: PgError };
type CookiesDb = {
  rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  from: (table: "cookie_grants" | "cookie_spends") => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        eq: (
          column: string,
          value: unknown,
        ) => PromiseLike<{ data: unknown[] | null; error: PgError }>;
        order: (
          column: string,
          opts: { ascending: boolean },
        ) => PromiseLike<{ data: unknown[] | null; error: PgError }>;
      };
    };
    insert: (values: Record<string, unknown>) => PromiseLike<{ error: PgError }>;
  };
};
const db = supabase as unknown as CookiesDb;

export type CookieBalance = { allowance: number; spent: number; remaining: number };

function toBalance(row: Record<string, unknown> | undefined | null): CookieBalance | null {
  if (!row) return null;
  const allowance = Number(row.allowance);
  const spent = Number(row.spent);
  const remaining = Number(row.remaining);
  if (!Number.isFinite(allowance) || !Number.isFinite(spent) || !Number.isFinite(remaining))
    return null;
  return { allowance, spent, remaining };
}

/**
 * The read that is currently in flight, if any, so that N mounted rings asking
 * at the same instant make ONE request between them.
 *
 * There are three rings on screen at once on a desktop page (sidebar, mobile
 * topbar, PageHeader) and they all listen to the same events, so every settle
 * and every tab-focus used to fan out into three identical cookie_balance()
 * calls in the same tick - the freshness window cannot catch those, because
 * none of them has returned yet when the next one starts. Sharing the promise
 * is the whole fix; there is no cache-invalidation question here because the
 * shared promise is discarded the moment it resolves.
 */
let inFlight: { userId: string; promise: Promise<CookieBalance | null> } | null = null;

function fetchBalance(userId: string): Promise<CookieBalance | null> {
  // Shared only with a caller asking about the SAME account. cookie_balance()
  // answers for whoever the session says you are, so handing an in-flight read
  // started under the previous account to a ring that has just mounted under
  // the new one would reintroduce exactly the wrong-student number that
  // cachedBalanceUserId exists to prevent.
  if (inFlight && inFlight.userId === userId) return inFlight.promise;
  const promise = readBalance(userId).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { userId, promise };
  return promise;
}

async function readBalance(userId: string): Promise<CookieBalance | null> {
  try {
    const { data, error } = await db.rpc("cookie_balance");
    if (error) {
      if (isMissingFunction(error)) schemaState = "absent";
      return null; // any other error leaves schemaState as-is; the next call retries
    }
    schemaState = "ready";
    const row = Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : (data as Record<string, unknown>);
    const balance = toBalance(row);
    if (balance) {
      cachedBalance = balance;
      cachedBalanceUserId = userId;
      lastFetchedAt = Date.now();
    }
    return balance;
  } catch {
    return null;
  }
}

// ── Cross-component signalling ──────────────────────────────────────────────
//
// Every action that spends cookies happens in a different module (chat-client,
// studybody-client, battle-royale-client, the last-minute page) and every ring
// (shell header, mobile drawer) is a separate mounted useCookies(). A DOM
// CustomEvent is the same bus the rest of the app already uses for this shape
// of problem - see "gd:gamification" in gamification.ts - rather than a new
// state library for two events.
const COOKIES_CHANGED_EVENT = "gd:cookies-changed";
const COOKIE_DIALOG_EVENT = "gd:cookie-dialog";
const COOKIES_OUT_EVENT = "gd:cookies-out";

/**
 * Call the moment a charged action is SENT, before the server has answered.
 * Moves every mounted ring immediately rather than waiting a full round trip -
 * the "optimistic local decrement" the plan asks for. Deliberately does NOT
 * also trigger a refetch: the real charge (server-side, inside the Edge
 * Function) may not have landed yet, and a refetch racing it would read stale
 * data and visibly bounce the ring back up before dropping again once the
 * action finishes. See reportCookiesSettled for the read that reconciles.
 */
export function reportCookieSpend(cost: number): void {
  if (typeof window === "undefined" || !(cost > 0)) return;
  if (cachedBalance) {
    cachedBalance = {
      ...cachedBalance,
      spent: cachedBalance.spent + cost,
      remaining: Math.max(0, cachedBalance.remaining - cost),
    };
  }
  window.dispatchEvent(new CustomEvent(COOKIES_CHANGED_EVENT, { detail: { decrement: cost } }));
}

/** Call once a charged action has finished, successfully or not, to reconcile with the server's own count. */
export function reportCookiesSettled(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIES_CHANGED_EVENT));
}

export type OutOfCookiesInfo = { remaining?: number; allowance?: number };

/**
 * Raise the empty-state dialog from anywhere: a 402 response, or a refused
 * client-side charge. `info` carries whatever the caller already has - a 402
 * body includes both numbers, so the dialog can show them immediately rather
 * than waiting on a second round trip while it is already telling the student
 * they were just refused.
 */
export function reportOutOfCookies(info: OutOfCookiesInfo = {}): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OutOfCookiesInfo>(COOKIES_OUT_EVENT, { detail: info }));
}

export type CookiesState =
  | { status: "loading"; balance: null }
  | { status: "ready"; balance: CookieBalance }
  | { status: "unavailable"; balance: null };

/**
 * One cookie_balance() read on mount, refetching whenever any charged action
 * anywhere in the app finishes, plus the optimistic local decrement described
 * above reportCookieSpend(). Every mounted instance (shell header ring, mobile
 * drawer ring) shares the same cachedBalance and the same events, so they can
 * never disagree with each other even for the one frame before a refetch
 * lands.
 *
 * Returns "unavailable" once schemaState has latched "absent" - the caller
 * MUST render nothing in that state ("No meter is better than a wrong meter",
 * per the plan). Guests get "unavailable" too: cookie_balance() reads
 * auth.uid(), and a guest's session is not what this budget is defending.
 */
export function useCookies(userId: string | null | undefined): CookiesState {
  const [state, setState] = useState<CookiesState>(() => {
    if (schemaState === "absent") return { status: "unavailable", balance: null };
    if (cachedBalance && userId && cachedBalanceUserId === userId)
      return { status: "ready", balance: cachedBalance };
    return { status: "loading", balance: null };
  });

  /**
   * Returns whether the question is now SETTLED - a real number arrived, or the
   * schema latched absent. False means "still nothing, and it might be worth
   * asking again", which is the only thing the mount retry below acts on.
   */
  const refetch = useCallback(async (): Promise<boolean> => {
    if (!userId || userId === "guest") return true;
    if (schemaState === "absent") {
      setState({ status: "unavailable", balance: null });
      return true;
    }
    const balance = await fetchBalance(userId);
    // currentSchemaState(), not `schemaState` directly - see its own comment.
    if (currentSchemaState() === "absent") {
      setState({ status: "unavailable", balance: null });
      return true;
    }
    // A transient error (network blip, timeout) leaves the previous reading on
    // screen rather than blanking it - the same "never a wrong flash for a bad
    // moment" posture the schema latch itself uses.
    if (balance) {
      setState({ status: "ready", balance });
      return true;
    }
    return false;
  }, [userId]);

  useEffect(() => {
    if (!userId || userId === "guest") {
      setState({ status: "unavailable", balance: null });
      return;
    }
    // A ring mounting next to rings that are already up - which is what every
    // navigation now does - reads the shared cache instead of asking again.
    // Keyed by user: see cachedBalanceUserId.
    if (cacheIsUsableFor(userId) && cachedBalance) {
      setState({ status: "ready", balance: cachedBalance });
      return;
    }

    // ── WHY THE FIRST READ RETRIES, AND NOTHING ELSE DOES ──────────────────
    //
    // "loading" renders nothing, exactly like "unavailable" - every ring is
    // behind `status === "ready"`. The difference is that "unavailable" is a
    // decision and "loading" is an absence, and before this retry the absence
    // was PERMANENT: refetch() only setState()s when the read succeeds, so one
    // failed cookie_balance() on mount - an expired token being refreshed, a
    // cold network, a five-second blip on a phone coming out of a tunnel -
    // left the hook in "loading" for the rest of the session. No ring, on any
    // page, until something else in the app happened to fire
    // COOKIES_CHANGED_EVENT. "The meter doesn't work" looks exactly like that.
    //
    // So the mount read - and ONLY the mount read - is retried a couple of
    // times with a widening gap. This is a READ. It cannot refuse anybody, it
    // cannot charge anybody, and if every attempt fails the outcome is the
    // same absence as before, so the fail-open contract at the head of this
    // file is untouched. `cancelled` stops the chain if the component unmounts
    // or the user changes mid-flight, so a signed-out tab is not still asking.
    let cancelled = false;
    const attempt = async (remaining: number, delayMs: number) => {
      if (cancelled) return;
      const settled = await refetch();
      if (cancelled || settled || remaining <= 0) return;
      window.setTimeout(() => void attempt(remaining - 1, delayMs * 3), delayMs);
    };
    void attempt(2, 1_200);
    return () => {
      cancelled = true;
    };
  }, [userId, refetch]);

  useEffect(() => {
    if (!userId || userId === "guest") return;
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ decrement?: number } | undefined>).detail;
      // cachedBalance was already updated synchronously by reportCookieSpend
      // before this event fired; mirror it into this instance's own state.
      // With no cached balance there is nothing to decrement FROM, so fall
      // through to a real read rather than returning empty-handed - otherwise
      // an action fired before the first balance landed would leave a ring
      // that never appears at all.
      if (detail?.decrement && cachedBalance && cachedBalanceUserId === userId) {
        setState({ status: "ready", balance: cachedBalance });
        return;
      }
      void refetch();
    };
    window.addEventListener(COOKIES_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(COOKIES_CHANGED_EVENT, onChanged);
  }, [userId, refetch]);

  // A tab left open across 00:00 UTC shows yesterday's number until something
  // spends. Re-reading when the tab comes back to the foreground - and only
  // when the cached number is already stale - costs one RPC on a real return
  // to the app and nothing at all on an alt-tab, and it is the same shape of
  // "the day may have rolled over while you were away" check the rest of the
  // app makes on focus. Still only a read; still cannot refuse anybody.
  useEffect(() => {
    if (!userId || userId === "guest") return;
    const onFocus = () => {
      if (document.visibilityState === "hidden") return;
      if (cacheIsUsableFor(userId)) return;
      void refetch();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [userId, refetch]);

  return state;
}

/** Subscribe to the empty-state dialog signal. Returns the unsubscribe function, React-effect style. */
export function onOutOfCookies(handler: (info: OutOfCookiesInfo) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<OutOfCookiesInfo>).detail ?? {});
  window.addEventListener(COOKIES_OUT_EVENT, listener);
  return () => window.removeEventListener(COOKIES_OUT_EVENT, listener);
}

/**
 * Ask the shell to open the cookie dialog.
 *
 * The dialog is mounted ONCE, in the app shell, because two of them stacked on
 * one tap would be worse than none. But the rings that open it are now spread
 * across the shell, the mobile topbar and PageHeader - which lives in
 * components/ui and knows nothing about the shell - so the request travels the
 * same CustomEvent bus the other two cookie signals already use rather than a
 * context provider added for one boolean.
 *
 * Deliberately NOT reportOutOfCookies(): tapping a ring with 32 cookies left is
 * not running out, and a function named for the empty case would be a lie at
 * every other level. The shell fills in the numbers from the live balance when
 * it opens, so this carries no payload.
 */
export function requestCookieDialog(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(COOKIE_DIALOG_EVENT));
}

export function onCookieDialogRequested(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = () => handler();
  window.addEventListener(COOKIE_DIALOG_EVENT, listener);
  return () => window.removeEventListener(COOKIE_DIALOG_EVENT, listener);
}

// ── Battle Royale: the one client-side charge ───────────────────────────────
//
// Every other priced action charges inside its Edge Function (see the plan's
// "Where the charge happens" section) because a browser-only charge is
// theatre - a student can call the function directly with their own token and
// skip it. Battle Royale is the deliberate exception: the underlying work is
// N calls to studybody's generate_questions (one per round in a roadmap
// series), and charging inside THAT function would charge once per round
// instead of once per match. So battle-royale-client.ts charges here, once,
// before building any round, using spend_cookies() - the auth.uid()-pinned,
// browser-reachable doorway (never spend_cookies_for(), which is service-role
// only and would fail outright from a browser).
export type CookieSpendOutcome =
  | { status: "spent"; spendId: number | null }
  | { status: "refused" }
  | { status: "skipped" };

export async function spendCookiesClientSide(
  action: CookieAction,
  cost: number,
): Promise<CookieSpendOutcome> {
  if (cost <= 0) return { status: "skipped" };
  try {
    const { data, error } = await db.rpc("spend_cookies", { p_action: action, p_cost: cost });
    if (error) {
      if (isMissingFunction(error)) schemaState = "absent";
      return { status: "skipped" }; // fail open - see the header note
    }
    schemaState = "ready";
    const row = Array.isArray(data)
      ? (data[0] as Record<string, unknown>)
      : (data as Record<string, unknown>);
    // Deliberately does NOT write cachedBalance. spend_cookies() is pinned to
    // auth.uid() so the number it returns is certainly the caller's, but this
    // function is not told WHOSE it is, and the shared cache is keyed by user
    // (see cachedBalanceUserId) precisely so a number can never be shown under
    // the wrong account. Every caller follows this with reportCookiesSettled(),
    // which re-reads through fetchBalance() and stamps the owner properly.
    if (row?.ok === false) return { status: "refused" };
    const spendId = typeof row?.spend_id === "number" ? (row.spend_id as number) : null;
    return { status: "spent", spendId };
  } catch {
    return { status: "skipped" };
  }
}

export async function refundCookiesClientSide(spendId: number | null): Promise<void> {
  if (spendId == null) return;
  try {
    await db.rpc("refund_cookie_spend", { p_spend_id: spendId });
  } catch {
    // Best effort - a missed refund costs one cookie on a match that already
    // failed to send, unfortunate, never blocking.
  }
}

// ── Admin: granting more ─────────────────────────────────────────────────────
//
// cookie_allowance(p_user) and spend_cookies_for() are both revoked from
// `authenticated` outright (service-role only, by design - see Section 8 of
// the migration), so an admin cannot call either from the browser even for
// someone else's account. What an admin CAN do, per the RLS policies in
// Sections 1 and 2 of the migration, is read cookie_spends and cookie_grants
// for ANY user directly ("... OR public.is_admin()"), and write cookie_grants
// outright. So the numbers below are assembled from those direct reads plus
// cookie_daily_base() (granted to every authenticated user) rather than from a
// single RPC that does not exist for this purpose.

export type CookieGrantRow = {
  id: number;
  extra_per_day: number;
  starts_on: string;
  ends_on: string | null;
  note: string | null;
};

function todayUtcKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * How one student's allowance is made up: days used, what that has earned,
 * what has been granted on top, and what today has cost so far.
 *
 * WHY THIS EXISTS. The grant screen used to print "base 50", which was true for
 * everybody. Since 20260824150000_cookie_ladder.sql the base is earned - 30,
 * plus 5 for every three days used, to a ceiling of 60 - so two students can
 * have different allowances with no grant between them and the screen has to be
 * able to say why. One RPC, so a base and a spend can never be read a second
 * apart and shown as if they belonged together.
 *
 * Returns null when the function is not there yet; the caller falls back to
 * cookieDailyBaseFor() + cookieSpentTodayFor(), which is what it used before.
 */
export type CookieStatus = {
  active_days: number;
  earned_base: number;
  granted_extra: number;
  allowance: number;
  spent_today: number;
};

export async function cookieStatusFor(userId: string): Promise<CookieStatus | null> {
  try {
    const { data, error } = await db.rpc("cookie_status_for", { p_user: userId });
    // Never latches schemaState: a 42501 here means "you are not an admin",
    // which says nothing about whether the cookie schema exists.
    if (error) return null;
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const r = row as Record<string, unknown>;
    const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    return {
      active_days: num(r.active_days),
      earned_base: num(r.earned_base),
      granted_extra: num(r.granted_extra),
      allowance: num(r.allowance),
      spent_today: num(r.spent_today),
    };
  } catch {
    return null;
  }
}

/**
 * The FLOOR of the earned ladder - read live rather than hard-coded. Only a
 * fallback for cookieStatusFor(). Null if the schema is not there.
 *
 * Never latches schemaState, in EITHER direction - same rule as
 * cookieStatusFor() above, and for a reason worth stating once for all four of
 * the admin readers below it: schemaState is process-wide and STICKY, and
 * latching it "absent" takes the meter away from this browser for the rest of
 * the session. Only the meter's own read (cookie_balance) and the client-side
 * charge (spend_cookies) are entitled to make that call, because only they are
 * asking the question the meter actually depends on. An admin screen failing to
 * read a grant table says nothing whatsoever about whether the student sitting
 * in this tab has a balance.
 */
export async function cookieDailyBaseFor(): Promise<number | null> {
  try {
    const { data, error } = await db.rpc("cookie_daily_base");
    if (error) return null;
    const value = Number(data);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Every grant on a student's account, newest first - active or not, so the admin can see history, not just today's total. */
export async function cookieGrantsFor(userId: string): Promise<CookieGrantRow[] | null> {
  try {
    const { data, error } = await db
      .from("cookie_grants")
      .select("id, extra_per_day, starts_on, ends_on, note")
      .eq("user_id", userId)
      .order("starts_on", { ascending: false });
    // A table read, and an admin-only one. It never latches schemaState - see
    // the note on cookieDailyBaseFor().
    if (error) return null;
    return (data as CookieGrantRow[] | null) ?? [];
  } catch {
    return null;
  }
}

/** Sum of today's cookie_spends rows for one student - can be negative-cancelling (a refund is a negative row), matching cookie_balance()'s own arithmetic. */
export async function cookieSpentTodayFor(userId: string): Promise<number | null> {
  try {
    const { data, error } = await db
      .from("cookie_spends")
      .select("cost")
      .eq("user_id", userId)
      .eq("spent_on", todayUtcKey());
    // Never latches schemaState - see the note on cookieDailyBaseFor().
    if (error) return null;
    const rows = (data as { cost: number }[] | null) ?? [];
    return Math.max(
      0,
      rows.reduce((sum, row) => sum + (Number(row.cost) || 0), 0),
    );
  } catch {
    return null;
  }
}

/** Insert one cookie_grants row. Returns whether it succeeded; the RLS policy itself refuses a non-admin caller, so a false here on an admin page means the schema is missing rather than a permissions problem. */
export async function createCookieGrant(input: {
  userId: string;
  extraPerDay: number;
  endsOn: string | null;
  note: string;
  grantedBy: string | null;
}): Promise<boolean> {
  try {
    const { error } = await db.from("cookie_grants").insert({
      user_id: input.userId,
      extra_per_day: input.extraPerDay,
      ends_on: input.endsOn,
      note: input.note || null,
      granted_by: input.grantedBy,
    });
    // Never latches schemaState - see the note on cookieDailyBaseFor().
    if (error) return false;
    return true;
  } catch {
    return false;
  }
}
