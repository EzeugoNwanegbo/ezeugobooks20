# Cookies, the milestone bar, and the new upload ladder

Owner's brief, 2026-08-24, broken down for implementation. Three separate pieces
of work. They ship independently and in this order; none of them depends on
another being finished first.

The SQL for part C is already written and reviewed: it is
`supabase/migrations/20260824130000_cookies_daily_budget.sql`, bundled as PART 5
of `supabase/APPLY-PENDING.sql`. **Do not write a new migration.** Build against
that one.

---

## House rules that override any habit

These are not style preferences. Each one is here because breaking it has
already cost this product an outage or a broken feature.

1. **Never name unapplied schema.** Migrations are applied by hand, by the
   owner, whenever they get to it. PostgREST rejects the *whole* statement when
   it meets a column or function it does not have, which took uploads down in
   production once. Every new-schema caller must **detect** the schema at
   runtime and degrade, never read a hand-flipped `X_APPLIED` constant. Copy the
   pattern in `src/lib/seen-once.ts` (`columnMissing` latch) or the one added to
   `src/lib/content-hash.ts` (`primeDedupSchema`). A constant is what made the
   share-with-G&D dialog invisible for weeks.
2. **Cookies fail OPEN.** A missing `spend_cookies`, a network error, a timeout,
   any error that is not an explicit `ok = false` → let the request through. The
   Edge Functions deploy separately from the SQL, so there will be a window
   where one exists without the other. Refusing in that window would lock every
   student out of every AI action at once.
3. **Comment the *why*, not the *what*.** This codebase explains decisions,
   trade-offs and rejected alternatives in prose above the code. Match the
   density of the file you are editing. A diff that adds behaviour and no
   reasoning does not match the house.
4. **No new colours, no new UI vocabulary.** The palette is Black / Bone /
   Copper, exposed as tokens (`bg-pop`, `text-pop`, `border-border`,
   `bg-surface`, `text-muted-foreground`). Amber is already used for warnings in
   `-app.practice-page.tsx` — reuse it, do not invent a second warning colour.
5. **"No explaining text, just clean."** The owner's standing instruction. New
   UI gets a number and a label, not a paragraph.
6. **Do not commit, push, or deploy anything.** `main` auto-deploys live. Leave
   the work in the tree.
7. **Never silently drop a student's action.** Existing rule from
   `src/lib/allowances.ts`, and it applies to cookies too: refuse clearly and
   say when it comes back, or let it through. Never half-do it.

---

## Part A — one long bar with milestones on it

**The complaint.** The points bar only shows progress *inside* the current rank,
so it empties every time you get promoted and there are no milestones on it. The
owner wants one long bar for the whole journey with the milestones marked along
it.

**The obstacle.** Rank thresholds (`src/lib/ranks.ts`) are 0, 50, 250, 500,
1,000, 2,000, 3,500, 5,000, 7,500, 10,000, 15,000. Drawn to scale, the first
three ranks occupy the leftmost 1.7% of the bar and are invisible.

**The fix.** Equal segments, not proportional ones. Eleven ranks make ten bands;
each band gets exactly 1/10 of the width, and position inside a band is linear
within that band's own point range. Every milestone is then evenly spaced and
the fill always reads as progress.

```
position = (rankIndex + earnedInBand / bandSize) / (RANKS.length - 1)
```

`rankProgress()` in `src/lib/gamification.ts` already returns `rank`,
`earnedInRank`, `pointsToNext` and the band size — derive the position from
those rather than recomputing thresholds.

**Build:** a new `RankLadderBar` in `src/components/rank-badge.tsx`, beside the
existing `RankProgressBar`.

- Ten ticks at `k/10`, one per rank boundary. Passed → filled (`bg-pop`); the
  next one → outlined; the rest → `bg-foreground/[0.15]`.
- Fill bar underneath, same 700ms ease-out transition the current bar uses —
  `src/components/progression-moment.tsx` has a comment asserting it matches, so
  keep them in sync.
- `role="progressbar"`, `aria-valuenow` as a 0–100 number, and an
  `aria-label` naming the current rank. Ticks are `aria-hidden`.
- No labels under the ticks. At 360px there is no room, and the rank name is
  already printed beside the bar everywhere this is used.

**Replace `RankProgressBar` with it in:** `src/routes/-app-shell.tsx` (~line
899), `src/routes/-app.leaderboard-page.tsx` (the global tab), and `RankSummary`
in `rank-badge.tsx`.

**Leave `RankProgressBar` alone in** `src/components/rank-up-celebration.tsx` and
`src/components/progression-card.tsx` — that animation is about crossing *one*
rank and sweeps 0→100 deliberately.

---

## Part B — uploads: 3 a day, 5 after five days, 7 at the top

Current state (`src/lib/allowances.ts`, `src/lib/ranks.ts`): base 5, plus a rank
bonus of +5 at Knowledge Cadet and +10 at Academic Scout, so 5 → 10 → 15.

**New ladder — the ceiling is 7, and that is a hard number:**

| Stage | Daily uploads |
|---|---|
| New account | **3** |
| After 5 days of use | **5** |
| Knowledge Cadet (50 pts) | **6** |
| Academic Scout (250 pts) and above | **7** |

**Changes:**

1. `BASE_DAILY_UPLOADS`: 5 → **3**.
2. New `EARNED_DAY_UPLOAD_BONUS = 2`, unlocked at `ACTIVE_DAYS_FOR_BONUS = 5`.
3. `RANKS[].uploadBonus` in `src/lib/ranks.ts`: recruit 0, cadet **1**, scout and
   every rank above it **2**. (3 base + 2 earned + 2 = 7.) The doc comment above
   `RANKS` says the bonus is an addition to `BASE_DAILY_UPLOADS (5)` — update it.
4. `allowanceFrom()` gains the earned bonus as its own field so the Library can
   show *where* the number came from. `UploadAllowance` gets `earnedBonus:
   number` and `earnedBonusUnlocked: boolean`.
5. The header comment of `allowances.ts` already claims "Base 3 a day" and is
   currently wrong. This makes it true — leave it correct.

**Counting the five days.** Owner's decision: **any five days, not five in a
row.** No such counter exists. `GamificationStats` tracks `currentStreak`,
`longestStreak` and `lastActiveDate`, but not a lifetime day count.

- Add `activeDays: number` to `GamificationStats` in `src/lib/gamification.ts`.
- Increment it in the same place `lastActiveDate` rolls to a new day. It only
  ever goes up, so missing a weekend costs nothing.
- **Seeding matters.** In `migrate()`, an existing student with any history
  (`points > 0` or `lastActiveDate` set) must seed to `ACTIVE_DAYS_FOR_BONUS`,
  not 0. Seeding 0 would demote every current student from 5 uploads to 3
  overnight and make them earn it back — a punishment for having been here
  first, and exactly the "never punitive" rule in the file header.

**The unlock moment.** When `activeDays` first reaches 5, show it once, ever.
Use the existing machinery — `useMomentReveal` / `MomentOverlay` in
`src/components/progression-moment.tsx`, the same one `rank-up-celebration.tsx`
drives. Bank the fact it fired in `GamificationStats` (a boolean, or follow the
`streakMilestonesAwarded: number[]` pattern already in the type) so a reload
cannot replay it. Copy: name the new number, nothing else.

---

## Part C — cookies

A daily budget for AI work. **50 a day**, refilling at 00:00 UTC — the same
instant uploads and the points caps already roll over.

### The price list

| Action | Cookies | Where it is spent |
|---|---|---|
| Chat message | **2** | `src/lib/chat-client.ts` → `supabase/functions/chat` |
| Question set | `ceil(count / 5)`, min 1 → a 40-set is 8 | `studybody`, action `generate_questions` |
| Flash cards | `ceil(count / 10)`, min 1 | `studybody`, action `generate_flashcards` |
| Roadmap build | **5** | `studybody`, action `generate_plan` |
| Last Minute | **5** | `supabase/functions/last-minute` |
| Battle Royale match | **3** flat | `src/lib/battle-royale-client.ts` — charge **once per match**, not per underlying `generate_questions` call |
| Marking answers | **0** | `review_answers`. They already paid for the set. |
| Uploads, OCR, embeddings | **0** | Already rationed by the upload allowance. Never double-charge. |

Chat at 2 is the number the owner chose the budget around: **20 chat messages =
40 cookies**, leaving 10 for a full question set (8) or two Last Minutes.

Put the price list in **one** module — `src/lib/cookies.ts` — as a
`COOKIE_COSTS` map plus a `costFor(action, count)` helper. The Edge Functions
cannot import it, so each one repeats *only its own* price with a comment
pointing back here. Never let a price exist in two editable places without a
note tying them together.

### The schema — already written, do not rewrite

`supabase/migrations/20260824130000_cookies_daily_budget.sql`, PART 5 of
`supabase/APPLY-PENDING.sql`. What it gives you:

- `cookie_spends` — append-only ledger. Today's spend is a SUM over today's
  rows, so there is no counter to reset and no cron job. RLS: read your own,
  **no insert policy for `authenticated`**.
- `cookie_grants` — extra cookies per day, admin-only writes. This is what makes
  the phone number in the empty state mean something.
- `cookie_balance()` → `(allowance, spent, remaining)` for the caller. Always
  returns exactly one row. **Read the allowance from here; never hard-code 50 in
  the client.**
- `spend_cookies(action, cost)` → `(ok, spend_id, allowance, spent, remaining)`.
  All-or-nothing. Browser-reachable, pinned to `auth.uid()`.
- `spend_cookies_for(user, action, cost)` — same, service-role only. **This is
  the one the Edge Functions call.**
- `refund_cookie_spend(spend_id)` — a negative row, once only.

### Where the charge happens, and why it is there

Charge **inside the Edge Function**, before the DeepSeek call, using
`spend_cookies_for` with the service role key and the user id resolved from the
request's JWT.

Charging in the browser only would be theatre: a student can call the function
directly with their own token and skip it. The whole reason this is server-side
is that the cap has to survive someone who does not want it.

Per function:

1. Resolve the caller's user id from the `Authorization` header.
2. `spend_cookies_for(user_id, action, cost)` via the service role.
3. `ok = false` → return **402** with
   `{ error: "out_of_cookies", remaining, allowance }` and do not call DeepSeek.
4. Any other outcome — function missing, error, timeout — **proceed**. Fail open.
5. If generation then fails outright (no questions, upstream 5xx), call
   `refund_cookie_spend(spend_id)`. Charge first, refund on failure: the other
   order means every abandoned generation is a call the owner paid for and
   nobody was charged for.

Functions to touch: `supabase/functions/chat`, `supabase/functions/studybody`,
`supabase/functions/last-minute`. **Do not** touch `embed`, `extract-pdf`,
`extract-image`, `ocr-enqueue`, `ocr-worker`, `suggest-folder`, `connect-dots`.

The client still reads the balance for the meter, and still shows the empty
state on a 402. It does not need to pre-check before every action — an optimistic
send that comes back 402 is one round trip, and it is the only version that
cannot disagree with the server.

### The meter — a ring, not a bar

The owner asked for a circular meter so a student can see what is left.

- New `CookieRing` in `src/components/cookie-ring.tsx`. Inline SVG, two circles,
  `stroke-dasharray` / `stroke-dashoffset` for the fill. No library.
- Remaining count in the middle, tabular numerals.
- `bg-pop`/copper stroke normally; switch to the existing amber at **10 or
  fewer** left. Track ring at `foreground/[0.08]`, matching `RankProgressBar`.
- `aria-label="32 of 50 cookies left today"`. The number in the middle is
  `aria-hidden` so a screen reader hears it once, not twice.
- Same 700ms ease-out as the rank bar; `motion-reduce:transition-none`.
- **Placement:** in the shell header beside the rank badge
  (`src/routes/-app-shell.tsx`, near line 899), and in the mobile drawer. Both
  need it — the drawer *is* the whole navigation below md.
- Tapping it opens the same dialog as the empty state, showing what today has
  gone on and the contact line.

**State:** a `useCookies()` hook in `src/lib/cookies.ts` — one `cookie_balance()`
read on mount, a refetch after any charged action, and an optimistic local
decrement so the ring moves the moment the student acts. If
`cookie_balance()` answers PGRST202 (function missing), the hook reports
"unavailable" and **the ring does not render at all**. No meter is better than a
wrong meter, and nothing is blocked in that state either.

### Running out

A dialog, raised when a 402 comes back, or from tapping an empty ring.

> **You're out of cookies for today.**
> They refill at 1:00 am.
> Need more now? Message or call G&D.
> **[ WhatsApp ]  [ Call 08105535057 ]**

- The refill time comes from `uploadResetLabel()` in `src/lib/allowances.ts` —
  it already renders the 00:00 UTC boundary in the student's own clock, so it is
  true in Lagos and in London. Do not write a second time formatter.
- **This dialog closes.** It has an X, Escape works, and clicking outside
  dismisses it. `share-with-gd-dialog.tsx` deliberately has no way out because
  it asks a question with two real answers; this one only reports a fact, and
  trapping someone in it would be hostile.
- Contact details go in **one** module, `src/lib/support-contact.ts`:
  `OWNER_PHONE_LOCAL = "08105535057"`, `OWNER_PHONE_E164 = "+2348105535057"`.
  WhatsApp → `https://wa.me/2348105535057?text=<prefilled>`; call →
  `tel:+2348105535057`. Prefill the WhatsApp message with the student's handle
  so the owner knows who is asking without having to ask.
- Display the local form. Dial the international one.

### Granting more

`/app/admin` (`src/routes/-app.admin-page.tsx`, already `is_admin`-gated) gets a
Cookies section: find a student by handle (`find_students`, PART 1 of the pending
SQL), see their allowance and today's spend, and insert a `cookie_grants` row —
extra per day, an optional end date, and a note.

Without this the empty-state dialog promises something the product cannot
deliver. It is part of the feature, not a follow-up.

---

## Order of work

1. **Part A** — pure UI, no schema, nothing can break. Land it first.
2. **Part B** — client only, one new stats field. Watch the seeding rule.
3. **Part C** — `src/lib/cookies.ts` and the ring first (read-only, harmless),
   then the admin grant screen, then the Edge Function charging last. The
   charging is the only part that can refuse a student, so it goes in when
   everything around it is already proven.

## Definition of done

- `npx tsc --noEmit` clean.
- `npx eslint <changed files>` clean.
- `deno check supabase/functions/<each touched>/index.ts` clean.
- With the SQL **not** applied: the ring is absent, nothing is charged, nothing
  is blocked, no console errors, every AI action works exactly as it does today.
- With the SQL applied: the ring shows 50, a chat message takes it to 48, an
  exhausted budget returns 402 and raises the dialog, and an admin grant raises
  the allowance on the next read.
- Nothing committed, nothing pushed, nothing deployed.
