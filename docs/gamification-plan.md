# Gamification, part two: the social and multiplayer layer

**Status: design only. Nothing in this document is built.**

Part one — named academic ranks, the rank-up and streak moments, daily point
caps, timed challenges, the My Coach entry choice, the upload allowance and the
progression card — is implemented and in the tree. This document covers what was
deliberately *not* built: usernames, friends, challenges, live player-vs-player,
best-of-3, school leaderboards and course leaderboards.

It exists because that half is months of work, it depends on a foundation that
does not exist yet, and half-built realtime PvP is worse than none. The order of
the sections below is the order the work has to happen in. Sections 1 and 2 are
not optional preliminaries that can be skipped to get to the fun part — they are
the reason the fun part currently cannot be built.

---

## 1. The blocker: points are client-side and trivially editable

### What is true today

Every point in G&D lives in the student's browser, in `localStorage`, under
`gd:gamification:<userId>`. `src/lib/gamification.ts` reads it, mutates it,
writes it back, and then best-effort-pushes the resulting total to
`user_profiles.points` so the leaderboard has something to rank.

The push is an ordinary authenticated `UPDATE` on the student's own profile row,
permitted by the RLS policy `"Users update own profile"`. So the complete
cheat is:

```js
// In any student's devtools console, on gd1.online:
const k = "gd:gamification:" + "<their-own-user-id>";
const s = JSON.parse(localStorage.getItem(k));
s.points = 999999;
s.currentStreak = 365;
localStorage.setItem(k, JSON.stringify(s));
// then trigger any gamification event, or open /app/leaderboard, and the
// value is pushed to the server as fact.
```

There is no server-side validation of that number anywhere. There is no record
of *what was done to earn it*. `user_profiles.points` is not a computed total,
it is whatever the client last claimed.

### Why that is tolerable today and fatal tomorrow

Right now points are, functionally, a **solo streak counter with a vanity
scoreboard attached**. If a student inflates their own number, the person they
have cheated is themselves. The global leaderboard is unverifiable, but the
stakes on it are zero — nothing is won, nothing is spent, and nobody is denied
anything because someone else's total is fake.

Every feature in this document changes that:

| Feature | What cheating buys | Who is harmed |
|---|---|---|
| Named ranks (already shipped) | Instant Academic General | Only the cheat's own sense of progress |
| Rank rewards / upload allowance (**now enforced**) | Unlimited uploads | The extraction + embedding bill — see below |
| School leaderboards | Fake glory for a real, named institution | Every honest student at that school |
| Course leaderboards | Same, in a smaller pool where it is more visible | Their actual classmates |
| Friend challenges | A win over someone who tried | One specific person, by name |
| **Live PvP** | The entire result | The opponent, in real time |

The upload allowance moved rows in that table on 2026-08-08: it is now
**enforced** (`ENFORCE_UPLOAD_LIMIT = true`), at 5 uploads a day rising to 10 at
Knowledge Cadet and 15 at Academic Scout. That makes it the first rank reward
with a real cost attached, and therefore the first place a fake point total buys
something concrete rather than a title.

The enforcement is **client-side only**, in `onUploadFiles`. A student who edits
`gd:uploads:<userId>` in localStorage — or their point total, to claim a rank
bonus they have not earned — uploads without limit. Two honest observations
about that:

- It is the right amount of defence *today*. What is being managed is ordinary
  bulk folder-dropping, not adversarial abuse, and the students who would open
  devtools to bypass a study-app upload cap are a rounding error against the
  ones who drag in a 40-file course folder without thinking.
- It stops being adequate the moment the allowance is the thing standing between
  a user and a real bill. If upload volume ever becomes the dominant cost line,
  the counter has to move server-side. The natural home is a
  `SECURITY DEFINER` function called before the extraction begins, counting
  `documents` rows created by that user since midnight UTC and returning the
  remaining allowance — rank bonus computed from the server's point total, which
  §1 makes trustworthy. That is a small piece of work, but it is strictly
  downstream of the ledger: a server-side allowance that derives its bonus from
  a client-supplied rank has moved the check without fixing anything.

PvP is the hard stop. A live match where each device self-reports its own score
is not a game, it is two clients exchanging claims. The winner is whoever edits
faster. **Do not build PvP on client-authoritative points.** It is not a matter
of degree or of trusting students; it is that the feature has no meaning.

### The migration path to server-authoritative points

The goal state: `user_profiles.points` becomes a *derived* value that no client
can write, computed from an append-only ledger of awards the server itself
granted.

**Step 1 — the ledger table.** Every award becomes a row. This is the single
most important table in the whole plan; everything else reads from it.

```sql
-- SKETCH, not a migration.
create table public.point_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  event_type   text not null,          -- matches GamificationEvent
  points       integer not null,       -- server-decided, never client-supplied
  earned_on    date not null default current_date,
  -- What the award was for. A session id, a match id, a roadmap id. Lets the
  -- same source be deduplicated and lets an award be traced back.
  source_kind  text,
  source_id    uuid,
  created_at   timestamptz not null default now()
);

-- The whole anti-farming model in one constraint: an award tied to a source can
-- only ever be granted once, no matter how many times the client asks.
create unique index point_events_source_uniq
  on public.point_events (user_id, source_kind, source_id)
  where source_id is not null;

create index point_events_user_day
  on public.point_events (user_id, earned_on);
```

**RLS:** `select` where `auth.uid() = user_id` (a student may read their own
history, which is what the leaderboard's "Recent points" panel already renders).
**No insert, update or delete policy at all for `authenticated`.** Rows are
written exclusively by `SECURITY DEFINER` functions and edge functions holding
the service role key. A table with no write policy and RLS enabled is
write-proof from the client — that is the entire security model, and it is worth
more than any amount of validation logic.

**Step 2 — awards move server-side.** The award decision has to happen where the
evidence is. Conveniently, most of it already does:

- **Question sets** — `study_sessions` / `study_answers` are already written
  server-side under RLS. A `SECURITY DEFINER` function
  `award_for_session(session_id)` can read the session, confirm it belongs to
  the caller, confirm `status = 'completed'`, count the answers itself, apply
  the daily caps in SQL against `point_events`, insert the rows, and return the
  new total. The client stops deciding anything and just calls it.
- **Timed challenges** — the timer budget is already persisted in
  `study_sessions.feedback.timer_seconds` at creation time, and `completed_at`
  is a server timestamp. The "beat the clock" bonus is therefore checkable
  server-side without trusting a single client value. (This was a deliberate
  choice in part one: the timer was stored on the session at creation rather
  than held in component state precisely so this migration is possible later.)
- **Streaks** — derived from `distinct earned_on` in `point_events`, not stored.
  A streak that is computed from the ledger cannot be edited.
- **Chat entry** — the weakest signal, and the one genuinely worth reconsidering.
  +2 for opening a page is a participation trophy that is hard to verify and
  easy to script. Consider dropping it rather than defending it.

**Step 3 — the total becomes derived.**

```sql
-- SKETCH
create or replace function public.recompute_points(target uuid) ...
-- called by a trigger on point_events; writes user_profiles.points.
```

Then **drop the client's ability to write the gamification columns**. The
current policy `"Users update own profile"` is a blanket `FOR UPDATE USING
(auth.uid() = id)` — it permits writing *any* column, including `points`. It
needs replacing with a column-restricted policy (or a `BEFORE UPDATE` trigger
that rejects changes to `points`, `weekly_points`, `current_streak`). Until that
is done, the ledger is decoration: a cheat can ignore it and write the profile
column directly.

**Step 4 — reconciling what students already have.** This is the part that will
get skipped and shouldn't be. Existing students have real point totals that were
honestly earned and have no ledger rows behind them. Deleting them to "start
clean" punishes the loyal users hardest.

The migration should insert one `point_events` row per user, `event_type =
'legacy_import'`, `points = user_profiles.points` as it stands on migration day,
`source_kind = 'legacy'`, `source_id = user_id`. That preserves every total,
makes the import visible and auditable rather than magic, and the unique index
guarantees it can only happen once. It also imports whatever inflation already
exists — which is the honest trade, and is why this should happen sooner rather
than after a public leaderboard push has given people a reason to cheat.

**Cost of step 1–4:** perhaps a week of focused work, most of it in SQL, none of
it novel. **Cost of skipping it:** every feature below is theatre.

---

## 2. The other blocker: the database is nearly full

This Supabase project is on the **free tier, with a 500 MB ceiling.** It was
recently *at* that ceiling and is now around **405 MB after a cleanup** — so
roughly **95 MB of headroom**, and a separate in-flight piece of work
(the `2026-08-08 dedup_*` migrations) is currently reclaiming chunk storage.

That number governs the design. It is why nothing below stores a question, an
answer, a chat message, or a match transcript. Every table here is
identifiers, small integers and timestamps.

### Per-feature storage estimate

Assume Postgres row overhead of ~24 bytes plus the tuple header and index
entries; in practice budget ~100–150 bytes per narrow row including its indexes.
Assume **2,000 active students** as the planning figure.

| Table | Row size (incl. indexes) | Rows at 2,000 students | Total | Growth shape |
|---|---|---|---|---|
| `point_events` | ~120 B | ~8/student/day → 5.8M/yr | **~700 MB/yr** ⚠️ | **Unbounded — needs a retention policy** |
| `user_profiles.username` (column) | ~20 B | 2,000 | ~40 KB | Fixed |
| `friendships` | ~110 B | ~15/student → 30,000 | ~3.5 MB | Linear, self-limiting (people have finite friends) |
| `challenges` | ~140 B | ~2/student/week → 200k/yr | ~28 MB/yr | Needs a 90-day purge |
| `match_participants` | ~130 B | 2 per match | ~52 MB/yr | Purge with the match |
| `match_events` (live PvP) | ~90 B | ~20 per match | **~180 MB/yr** ⚠️ | **Must be ephemeral, see §6** |
| `institutions` | ~200 B | ~500 | ~100 KB | Fixed |
| `institution_aliases` | ~150 B | ~2,000 | ~300 KB | Slow |
| `courses` | ~150 B | ~300 | ~45 KB | Fixed |

**The two flagged rows are the design constraints.**

`point_events` is the one that will actually break things, and it is the table
that cannot be skipped. Mitigations, in order of preference:

1. **Roll up and prune.** Keep raw events for 60 days; collapse anything older
   into one `point_events_monthly` row per user per month per event type. That
   turns ~700 MB/yr into a few MB/yr while preserving totals exactly and keeping
   the "Recent points" panel (which only ever shows 8 rows) fully functional.
2. **Don't log the cheap stuff.** `chat_entered` at +2 would be roughly an eighth
   of all rows for the least meaningful award in the system.
3. **Store the daily cap ledger as one row per user per day**, `jsonb` keyed by
   event type, rather than one row per award. Fewer, wider rows.

`match_events` should not be a durable table at all — see §6.

**Honest conclusion on the free tier:** the social layer as specified does not
fit in 95 MB at 2,000 students without the rollup policy, and a paid Supabase
tier (the $25/mo Pro plan, 8 GB) is the realistic precondition for launching
live PvP. That should be a stated, budgeted decision before the work starts, not
a surprise discovered at 480 MB on a Sunday night.

---

## 3. Public usernames

### Why this comes first

Friend search needs something to search on, and today `user_profiles` has only
`name` (a display name, not unique, not something a student chose to be
findable by) and the account's email in `auth.users`.

**Email must never be exposed.** Not in a search result, not in an error message
("no account with that email" is itself a disclosure), not in an RPC return
shape, not in a "did you mean" hint. A study app for medical and law students
holds a roster of identifiable people at named institutions; leaking who has an
account is a real harm, not a hypothetical one.

The answer is a separate, deliberately-chosen, public handle.

### Table

```sql
-- SKETCH
alter table public.user_profiles
  add column username text unique,
  add column username_set_at timestamptz;

-- Case-insensitive uniqueness, and a shape that cannot be confused for an email.
create unique index user_profiles_username_lower
  on public.user_profiles (lower(username));

alter table public.user_profiles
  add constraint username_shape
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');
```

Nullable on purpose: a student who never wants to be findable never sets one,
and is then genuinely unsearchable rather than merely hidden by a preference
flag.

### RLS implications — the important part

`user_profiles` RLS today is strictly own-row:

```sql
CREATE POLICY "Users view own profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);
```

So **friend search cannot be a `select` on `user_profiles`.** Widening that
policy to let students read other people's rows would expose `university`,
`year`, `discipline`, `personalization_background` — the last of which is a
free-text "who I am" paragraph the student wrote about themselves. That would be
a serious privacy regression.

The correct shape is the one the leaderboard already uses: a `SECURITY DEFINER`
function that reads across users and returns **only** a deliberately chosen
projection.

```sql
-- SKETCH
create or replace function public.find_student(handle text)
returns table (user_id uuid, username text, display_name text, rank_points integer)
language sql stable security definer set search_path = public as $$
  select p.id, p.username, coalesce(nullif(btrim(p.name), ''), 'Student'), p.points
  from public.user_profiles p
  where p.username is not null
    and lower(p.username) = lower(btrim(handle))   -- EXACT match only
  limit 1;
$$;
```

**Exact match, not prefix or fuzzy.** A `LIKE 'ade%'` search turns this function
into a user-enumeration endpoint that will happily dump the roster. Exact match
means you can only find someone whose handle you were already told. That is the
correct trade for this product, and it should be defended when someone asks for
a nicer search experience.

**Cost/risk:** low cost, and the one piece here worth doing early — a unique
handle is useful on its own (it makes the existing leaderboard less ambiguous
than a list of duplicate display names). The risk is a bad rollout: usernames
are first-come-first-served and effectively permanent, so land the shape
constraint and a reserved-word list (`admin`, `gd`, `support`, `official`) in
the *first* migration, not the second.

---

## 4. Friends: requests, accept, decline, list

### Table

One row per relationship, not two, with a canonical ordering so the pair is
unique regardless of who asked.

```sql
-- SKETCH
create table public.friendships (
  -- Always the lexicographically smaller uuid, enforced below.
  user_a      uuid not null references auth.users(id) on delete cascade,
  user_b      uuid not null references auth.users(id) on delete cascade,
  -- Who sent the request. Needed to render "accept/decline" vs "pending" and
  -- to stop the recipient's decline being re-sent as a new request instantly.
  requested_by uuid not null references auth.users(id) on delete cascade,
  status      text not null check (status in ('pending','accepted','blocked')),
  created_at  timestamptz not null default now(),
  responded_at timestamptz,
  primary key (user_a, user_b),
  constraint ordered_pair check (user_a < user_b)
);

create index friendships_b on public.friendships (user_b) where status = 'accepted';
```

Note there is no `'declined'` status. A decline **deletes the row**. Keeping a
tombstone means the sender can see they were declined, which is a small cruelty
the product does not need, and it leaves rows around forever. Rate-limiting
re-requests is better handled by a short-lived check than by permanent state.

### RLS

```sql
-- SKETCH
-- See only your own relationships.
create policy friendships_select on public.friendships for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- Send a request: you must be a party to it, and you must be the requester.
create policy friendships_insert on public.friendships for insert
  with check (
    (auth.uid() = user_a or auth.uid() = user_b)
    and auth.uid() = requested_by
    and status = 'pending'
  );

-- Accept/decline: only the OTHER party may respond.
create policy friendships_update on public.friendships for update
  using ((auth.uid() = user_a or auth.uid() = user_b) and auth.uid() <> requested_by);

create policy friendships_delete on public.friendships for delete
  using (auth.uid() = user_a or auth.uid() = user_b);
```

The `auth.uid() <> requested_by` on `UPDATE` is the whole feature: without it a
student can accept their own friend request and add anyone whose uuid they know
to their friends list unilaterally.

**A trap worth naming:** rendering a friends list means showing other people's
names, which `user_profiles` RLS forbids. Either every friends-list read goes
through a `SECURITY DEFINER` function that joins and projects, or the accepted
friendship denormalizes the two display names onto its own row. The function is
cleaner; the denormalized copy is cheaper and goes stale. Prefer the function
and accept the extra RPC.

### Privacy controls

The brief mentions privacy controls, and the minimum honest set is small:

- `username` unset → invisible to search entirely.
- A `discoverable` boolean is redundant if usernames are opt-in. Don't add two
  switches for one decision.
- Blocking is `status = 'blocked'`, and a blocked pair must be excluded from
  challenges, PvP invites *and* from appearing in each other's course/school
  leaderboards. That last one is easy to forget and is exactly the case that
  matters — leaderboards are the surface where someone you blocked reappears.

**Cost/risk:** medium cost, low technical risk, and the social-graph piece is
the one most likely to generate support requests ("I can't find my friend").
Budget time for the empty states and error copy, not just the tables.

---

## 5. The challenge flow (asynchronous)

Before live PvP, build the asynchronous version. It is ~20% of the work, has
none of the realtime risk, and is likely to be the mode students actually use —
two medical students are rarely free at the same minute.

**Flow:** A challenges B on a topic → both are served **the same generated
question set** → each plays it whenever they like → when both have finished, or
a deadline passes, the result resolves.

The critical design point is **the question set is generated once and shared.**
Generating separately per player means comparing scores on different questions,
which is not a contest. This has a pleasant side effect: a challenge costs the
same in AI spend as one ordinary practice set, not two.

```sql
-- SKETCH
create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  challenger   uuid not null references auth.users(id) on delete cascade,
  opponent     uuid not null references auth.users(id) on delete cascade,
  -- The shared set. One study_sessions row per player pointing at the same
  -- question rows, or a dedicated question_set_id — see the note below.
  question_set_id uuid not null,
  mode         text not null check (mode in ('async','live')),
  best_of      smallint not null default 1 check (best_of in (1,3)),
  status       text not null check (status in ('pending','active','complete','expired')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now()
);

create table public.match_participants (
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  round        smallint not null default 1,
  score        smallint,                    -- correct answers
  duration_ms  integer,                     -- completion time, the tiebreak
  finished_at  timestamptz,
  primary key (challenge_id, user_id, round)
);
```

**The awkward bit, stated plainly:** `study_questions` today is
`user_id`-scoped with `FOR ALL USING (auth.uid() = user_id)` and carries
`session_id`, `plan_id` and `topic_id` as NOT NULL foreign keys. A question set
shared by two students does not fit that shape. Options:

1. **Duplicate the question rows per player.** Zero schema change, works
   immediately, doubles the row count per challenge. Given the storage ceiling
   in §2, this is worse than it sounds at scale but is fine for a pilot.
2. **Add `challenge_id` to `study_questions` and widen the RLS policy** to
   `auth.uid() = user_id OR challenge_id in (select ... from match_participants
   where user_id = auth.uid())`. Cleaner, one copy, and the policy is the
   delicate part — it must not become a way to read arbitrary questions.
3. **A separate `challenge_questions` table.** Cleanest isolation, most code,
   and now there are two question systems to maintain.

Recommend (2), and write the policy test before the feature.

**Resolution:** higher `score` wins; if equal, lower `duration_ms` wins; if both
equal, a draw (and draws must be renderable — this will happen on short sets).
Resolution runs in a `SECURITY DEFINER` function, never on a client, and must
be idempotent because both players' clients will call it.

**Cost/risk:** medium. The real risk is **abandonment** — challenges that are
never played. `expires_at` and a scheduled sweep are not polish, they are the
difference between a feature and a graveyard of pending invitations.

---

## 6. Live PvP

Same question set, both devices at once, scored on correctness with completion
time as the tiebreak.

### Realtime approach

Supabase Realtime offers three mechanisms; the right answer uses two of them and
avoids the third.

- **Broadcast** (ephemeral pub/sub, nothing persisted) — use this for the
  per-question ticks: "opponent answered Q4", "opponent finished". These are
  *presence theatre*. They make the match feel live and they must never be
  trusted for scoring. This is what keeps `match_events` out of the database
  entirely, which §2 requires.
- **Presence** — use this for connection state: who is in the match room, who
  dropped. Presence is also ephemeral.
- **Postgres Changes** (row-level subscriptions) — use this *only* for the
  authoritative result row, i.e. the client subscribes to its own
  `match_participants` / `challenges` row and re-renders when the server writes
  the outcome. Do not subscribe both players to a firehose of per-answer rows;
  that is the expensive option and it does not buy anything Broadcast doesn't.

**The rule that makes this safe: the client broadcasts feelings, the server
records facts.** A win is written by a `SECURITY DEFINER` function that recounts
from the stored answers. Broadcast messages influence nothing but animation.

### Failure modes that must be designed, not discovered

Every one of these will happen on day one, on a Nigerian mobile network, in a
lecture hall:

| Failure | Required behaviour |
|---|---|
| One player disconnects mid-match | Match holds; grace window (~60 s); then the connected player wins by default and is *told that is why* |
| Both disconnect | Match expires to a draw, neither is penalised |
| One never opens the match | `expires_at` sweep; no result recorded, no rank change |
| Clocks disagree between devices | Never compare device clocks. `duration_ms` is (server-stamped finish) − (server-stamped start), or it is not trustworthy |
| App backgrounded on mobile (Capacitor) | The websocket dies silently on Android. Treat resume-from-background as a reconnect, not a continuation |

That last row is why the Capacitor build makes live PvP meaningfully harder than
it looks in a desktop browser.

**Cost/risk: this is the most expensive and riskiest item in the document, by a
wide margin.** It needs server-authoritative points (§1), a paid Supabase tier
(§2), shared question sets (§5), and a full reconnection state machine. Estimate
weeks, not days. **It should be the last thing built, and the asynchronous
challenge in §5 should be shipped and used first** — if students don't play
async challenges, they will not play live ones, and that is worth learning for
the price of §5 rather than the price of §6.

### Best-of-3

A thin layer over the above: `challenges.best_of = 3`, `match_participants.round`
already carries the round number, and a match resolves when one player has two
round wins. The genuinely new decisions are product ones: does round 2 use a new
question set (yes — otherwise it is a memory test), and can a player forfeit
mid-series without it counting as a loss (they should be able to, and it should
count as a loss, or forfeiting becomes the strategy for avoiding one).

### Boss battles

Mentioned in the brief and defined in the points table (`boss_battle_win`, +50)
but not designed here. It is a single-player mode against a hard question set —
which means it needs none of §4, §5 or §6. **If the appetite is for something
competitive to ship soon, this is the cheap one**, and it is the only item in
this document that does not depend on live realtime.

---

## 7. School leaderboards

### The problem, stated precisely

`user_profiles.university` is a free-text box a student typed into during
onboarding. It contains, right now and with certainty:

```
Veritas                    Veritas University        Veritas University Abuja
VUA                        veritas uni               University of Lagos
Unilag                     UNILAG                    Univ. of Lagos
Uni of Lagos               LASU                      Lagos State University
```

`Unilag` and `University of Lagos` are the same institution. `LASU` and `UNILAG`
are **not**, despite being one edit apart in the way people abbreviate them.
`Veritas` and `Veritas University Abuja` probably are, but a Veritas in another
state would not be.

### The rule: never auto-merge by name similarity

This is the central constraint, and it is worth being explicit about why. A
fuzzy matcher tuned loosely enough to merge `Unilag` → `University of Lagos`
will also merge `LASU` → `UNILAG`, and the failure is not cosmetic: it puts
students on a leaderboard for a school they do not attend, and it is the kind of
error that reads as the app being careless about who they are. String distance
does not encode institutional identity and no threshold will make it.

The model is therefore **normalize → alias → confidence → admin correction**,
where the automated part only ever *proposes*.

```sql
-- SKETCH
create table public.institutions (
  id            uuid primary key default gen_random_uuid(),
  canonical_name text not null,          -- "University of Lagos"
  country       text,
  verified      boolean not null default false,  -- an admin has confirmed it exists
  created_at    timestamptz not null default now()
);

create table public.institution_aliases (
  id             uuid primary key default gen_random_uuid(),
  institution_id uuid references public.institutions(id) on delete cascade,
  -- The normalized form: lowercased, punctuation stripped, "university"/"uni"/
  -- "univ" collapsed, leading "the" removed, whitespace squeezed.
  normalized     text not null unique,
  raw_example    text,                   -- what a student actually typed
  -- 'exact'  : normalized string matched a known alias
  -- 'admin'  : a human mapped it
  -- 'proposed': the matcher's guess, NOT yet in effect
  confidence     text not null check (confidence in ('exact','admin','proposed')),
  proposed_score real,                   -- similarity, for the admin queue only
  created_at     timestamptz not null default now()
);

alter table public.user_profiles
  add column institution_id uuid references public.institutions(id);
```

### How a student gets attached to a school

1. Normalize what they typed.
2. Exact hit on `institution_aliases.normalized` with confidence `exact` or
   `admin` → attach. Done, no human involved.
3. No hit → **the student is unaffiliated.** They are not guessed at. They see
   their global rank and their course rank, and a quiet "add your school" prompt.
4. In parallel, the matcher writes a `proposed` alias with its similarity score
   into an **admin queue**. `proposed` rows have no effect on any leaderboard
   until an admin promotes them to `admin`.

Step 3 is the one that will be argued with, because it means the school
leaderboard is empty for a while. That emptiness is correct: an empty
leaderboard is a smaller problem than a wrong one, and the queue drains quickly
because the long tail of a Nigerian medical-school user base is a few hundred
institutions, not thousands.

The app already has an admin surface (`/app/admin`, gated on
`user_profiles.is_admin`, built for the shared library) — the alias queue is a
second tab there, not new infrastructure.

### RLS

`institutions` and `institution_aliases`: `select` for `authenticated` (they are
public reference data, and the client needs them for the onboarding picker).
Write access for `is_admin` only, checked inside a `SECURITY DEFINER` function
rather than in a policy that trusts a claim.

School standings are a `SECURITY DEFINER` RPC in the same shape as the existing
`leaderboard_top()`, filtered by `institution_id`, **with a minimum cohort size
(say 5) before a school's board is shown at all.** A leaderboard of one is not a
leaderboard, it is that person's points with their school's name attached, and
at small counts it deanonymizes individuals inside a named institution.

### The best fix is upstream

Every problem in this section is caused by a free-text box. Changing onboarding
to a **searchable picker over `institutions` with "my school isn't listed" as
the escape hatch** stops new bad data at the source and costs a fraction of what
the reconciliation machinery costs. Do this first; it makes the backfill a
finite, shrinking job instead of a permanent one.

**Cost/risk:** medium cost, and the risk is entirely operational rather than
technical — someone has to actually work the alias queue. If nobody owns it, the
feature degrades to "most students are unaffiliated" and quietly dies.

---

## 8. Course leaderboards

The owner is explicit and correct: **no separate medicine/law gaming systems.**
One progression system, one set of ranks, one points economy. A course
leaderboard is a *filter* over the existing board, not a parallel product.

`user_profiles` already carries `course` (free text), `discipline`
(`medicine` | `law`), `study_track` and `year`. `course` has exactly the same
free-text disease as `university` and needs exactly the same treatment, with one
simplification that makes it much easier: the space of courses is small,
bounded, and largely known in advance.

```sql
-- SKETCH
create table public.courses (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,        -- "Medicine and Surgery (MBBS)", "LLB"
  discipline text check (discipline in ('medicine','law')),
  unique (name, discipline)
);

alter table public.user_profiles add column course_id uuid references public.courses(id);
```

Seed it with the real list and make onboarding a picker. `discipline` on the
course row exists to scope the picker sensibly, **not** to fork the game: a
medical student and a law student earn points identically, hold the same ranks,
and appear on the same global board. `discipline` filters *who you are compared
with when you ask to be*, and nothing else.

Sensible comparison scopes, all the same RPC with different filters: global
(exists today), school, course, course + year ("Year 3 MBBS"), and friends.
Course + year is probably the one students actually care about, since it is the
group they sit exams with.

Same minimum-cohort rule as §7. Same `SECURITY DEFINER` projection — a course
leaderboard must not become a way to enumerate everyone studying law at a named
university.

**Cost/risk:** the cheapest item in this document, and probably the highest
value per hour. It needs no realtime, no social graph, no new privacy surface,
and it works the day `course_id` is populated.

---

## 9. Recommended order

Sequenced by dependency and by risk, not by excitement:

| # | Work | Depends on | Notes |
|---|---|---|---|
| 1 | **Server-authoritative points** (§1) | — | Everything below is meaningless without it |
| 2 | Onboarding pickers for school + course (§7, §8) | — | Do this early; it stops the bad data at source |
| 3 | Course leaderboards (§8) | 1, 2 | Cheapest real win |
| 4 | Public usernames (§3) | — | Useful alone; unblocks friends |
| 5 | School leaderboards + alias admin queue (§7) | 1, 2 | Needs an owner for the queue |
| 6 | Friends: request / accept / decline / list (§4) | 4 | |
| 7 | Boss battles | 1 | Single-player; competitive feel, none of the realtime cost |
| 8 | Asynchronous challenges (§5) | 1, 6 | Ship and measure before building 9 |
| 9 | Best-of-3 (§6) | 8 | Thin layer |
| 10 | **Live PvP** (§6) | 1, 8, paid tier | Last. Weeks. Do not start early |

Between steps 3 and 5, expect to move off the free tier.

---

## 10. Summary of the honest risks

1. **Points are cheatable today.** Nothing above should ship before §1, and the
   fix is not just the ledger — it is also revoking the client's ability to
   `UPDATE user_profiles.points`, which the current blanket update policy allows.
2. **The database will not hold this on the free tier.** ~95 MB of headroom
   against a points ledger that grows ~700 MB/year at 2,000 students. Rollups
   are mandatory; a paid tier is the realistic answer before live PvP.
3. **Live PvP is the highest-cost, highest-risk item and the least certain to be
   used.** Async challenges test the same appetite for a fraction of the price.
4. **School normalization is an ongoing human job, not a shipped algorithm.**
   Auto-merging by name similarity is explicitly rejected; the cost of that
   correctness is an admin queue somebody has to work.
5. **Small-cohort leaderboards deanonymize people** at named institutions.
   Minimum cohort sizes are a privacy control, not a polish item.
6. **The daily upload allowance is enforced on the client only.** Bypassable by
   anyone who opens devtools. Acceptable while the allowance is shaping ordinary
   behaviour; not acceptable if it ever becomes the control on a real bill.
7. **Email must never appear in any social surface** — including in the negative,
   via "no such account" responses. Exact-match username lookup only; no prefix
   search, because it is a roster-enumeration endpoint wearing a friendly hat.
