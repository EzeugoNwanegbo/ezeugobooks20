-- The social layer: public usernames, friends, and ASYNCHRONOUS challenges.
--
-- Implements sections 3, 4 and 5 of docs/gamification-plan.md. Sections 6
-- (live PvP), 7 (school leaderboards) and 8 (course leaderboards) are NOT here
-- and nothing below assumes them.
--
--
-- ── THIS IS ONE FILE ON PURPOSE ──────────────────────────────────────────────
-- The dedup work is five files because it moves and deletes 380 MB of existing
-- data and each stage had to be inspected before the next was armed. This
-- migration adds only new objects: it reads nothing, moves nothing, deletes
-- nothing, and changes no existing table, policy, function or index. There is
-- therefore no intermediate state worth stopping at.
--
-- More importantly, the whole feature is gated in the app by ONE boolean,
-- src/lib/social.ts SOCIAL_SCHEMA_APPLIED. One flag must mean one migration. If
-- this were split and only half applied, the flag would be a lie in exactly the
-- way that took uploads down before: PostgREST rejects an entire statement that
-- names an unknown column, view or function, so a half-applied schema is not
-- degraded, it is broken.
--
-- Apply this file, then in the SAME commit flip SOCIAL_SCHEMA_APPLIED to true.
-- Not before, and not in a separate deploy.
--
-- After applying, tell PostgREST about the new functions or the first RPC call
-- will 404 against a stale schema cache:
--     NOTIFY pgrst, 'reload schema';
--
-- It is safe to run twice: every object is IF NOT EXISTS / OR REPLACE, and
-- every policy is dropped before it is created.
--
--
-- ── ROLLBACK ─────────────────────────────────────────────────────────────────
-- Set SOCIAL_SCHEMA_APPLIED = false and deploy FIRST (the app then stops naming
-- any of this), then:
--
--   drop function if exists public.purge_challenge_question_copies(int);
--   drop function if exists public.purge_old_challenges(int);
--   drop function if exists public.challenge_list_mine(int);
--   drop function if exists public.challenge_cancel(uuid);
--   drop function if exists public.challenge_decline(uuid);
--   drop function if exists public.challenge_submit(uuid);
--   drop function if exists public.challenge_submit_for_session(uuid);
--   drop function if exists public.challenge_begin(uuid);
--   drop function if exists public.challenge_create(text, uuid);
--   drop function if exists public.challenge_resolve(uuid);
--   drop function if exists public.challenge_score_session(uuid);
--   drop table if exists public.challenge_participants;
--   drop table if exists public.challenges;
--   drop function if exists public.friend_block(uuid);
--   drop function if exists public.friend_remove(uuid);
--   drop function if exists public.friend_respond(uuid, boolean);
--   drop function if exists public.friend_request(text);
--   drop function if exists public.friend_requests_mine();
--   drop function if exists public.friend_list();
--   drop function if exists public.are_friends(uuid, uuid);
--   drop table if exists public.friendships;
--   drop function if exists public.find_student(text);
--   drop function if exists public.set_discoverability(text);
--   drop function if exists public.claim_username(text);
--   drop table if exists public.reserved_usernames;
--   drop function if exists public.is_guest_account(uuid);
--   drop index if exists public.user_profiles_username_lower;
--   alter table public.user_profiles
--     drop column if exists username,
--     drop column if exists username_set_at,
--     drop column if exists discoverable_by;
--
-- Dropping the columns destroys every claimed handle, and handles are
-- first-come-first-served, so a rollback after students have claimed them is
-- not reversible in the way the word suggests. Roll back the same day or not
-- at all.
--
--
-- ── WHAT IS DELIBERATELY ABSENT ──────────────────────────────────────────────
--   * No points are awarded for anything here. A challenge result computed from
--     stored answers is trustworthy; user_profiles.points is not (it is whatever
--     the client last wrote - see §1 of the plan). Recording a result is safe;
--     paying for it is not, until §1 is done. EVENT_POINTS.pvp_win stays unwired.
--   * No realtime, no broadcast, no presence, no live matchmaking, no best-of-3,
--     no boss battles, no school or course leaderboards.
--   * No per-question event stream. A challenge stores two rows of small
--     integers and timestamps, and nothing else.


-- ═══ 1. PUBLIC USERNAMES ═════════════════════════════════════════════════════
--
-- Friend search needs something to search on. user_profiles today has `name`
-- (a display name, not unique, not chosen to be findable by) and the account's
-- email lives in auth.users. Email must never be exposed - not in a result, not
-- in an error, not in the negative ("no account with that email" is itself a
-- disclosure). So: a separate, deliberately-chosen, public handle.

ALTER TABLE public.user_profiles
  -- NULLABLE ON PURPOSE. A student who never wants to be findable never sets
  -- one, and is then genuinely unsearchable rather than merely hidden behind a
  -- preference flag that a future bug could invert.
  ADD COLUMN IF NOT EXISTS username TEXT,
  -- When it was last claimed. Backs the change cooldown in claim_username().
  ADD COLUMN IF NOT EXISTS username_set_at TIMESTAMPTZ,
  -- "Who can find me". The plan (§4) argues a discoverability flag is redundant
  -- if handles are opt-in, and it is nearly right - but the two are not the same
  -- action. Clearing your handle is destructive and irreversible in practice:
  -- it is released for anyone else to claim, and existing friends lose the label
  -- they know you by. 'nobody' is a reversible pause that keeps your handle.
  -- The UI shows ONE control, so students are not asked the same question twice.
  --
  -- 'friends_of_friends' is DEFERRED, not forgotten - see find_student() below.
  ADD COLUMN IF NOT EXISTS discoverable_by TEXT NOT NULL DEFAULT 'anyone';

DO $$
BEGIN
  -- Shape: lowercase, alphanumeric + underscore, 3-20. Chosen so a handle can
  -- never be mistaken for (or hold) an email address: no '@', no '.'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_username_shape'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_username_shape
      CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,20}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_profiles'::regclass AND conname = 'user_profiles_discoverable_by'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_discoverable_by
      CHECK (discoverable_by IN ('anyone', 'nobody'));
  END IF;
END
$$;

-- Case-insensitive uniqueness. claim_username() lowercases before writing, so
-- this is belt and braces - but it is the belt that makes handle allocation
-- first-come-first-served rather than last-write-wins, and it is the only thing
-- standing between two students and the same identity.
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_username_lower
  ON public.user_profiles (lower(username))
  WHERE username IS NOT NULL;

COMMENT ON COLUMN public.user_profiles.username IS
  'Public handle, ^[a-z0-9_]{3,20}$, unique case-insensitively. NULL = not findable at all. Never derived from and never comparable to an email address.';
COMMENT ON COLUMN public.user_profiles.discoverable_by IS
  'anyone | nobody. Applies to find_student() only - it never hides you from students who are already your friends.';

-- Handles that must not be claimable by a student, landed in the FIRST
-- migration rather than the second because handles are effectively permanent
-- and reclaiming one from a real student is a support problem, not a query.
CREATE TABLE IF NOT EXISTS public.reserved_usernames (
  name TEXT PRIMARY KEY
);

INSERT INTO public.reserved_usernames (name) VALUES
  ('admin'), ('administrator'), ('root'), ('support'), ('help'), ('helpdesk'),
  ('gd'), ('gandd'), ('gd1'), ('official'), ('team'), ('staff'), ('mod'),
  ('moderator'), ('system'), ('security'), ('billing'), ('payments'),
  ('me'), ('you'), ('null'), ('undefined'), ('anonymous'), ('guest'),
  ('student'), ('coach'), ('mycoach'), ('api'), ('www'), ('app'), ('login'),
  ('signup'), ('auth'), ('settings'), ('privacy'), ('terms'), ('contact')
ON CONFLICT (name) DO NOTHING;

-- Reference data with no personal content, but there is no reason for a client
-- to enumerate it either: claim_username() reports the refusal itself.
ALTER TABLE public.reserved_usernames ENABLE ROW LEVEL SECURITY;
-- RLS enabled with ZERO policies = readable and writable by nobody through
-- PostgREST. Only SECURITY DEFINER functions below see it. This is the same
-- model the plan specifies for point_events, and it is worth more than any
-- amount of validation logic: there is no policy to get wrong.


-- ═══ 2. GUESTS ═══════════════════════════════════════════════════════════════
--
-- A guest in this app is a real Supabase ANONYMOUS auth user (see
-- src/lib/guest-session.ts): they have a genuine auth.uid(), a real
-- user_profiles row (created by the client with name 'Guest'), and they pass
-- every RLS check an ordinary student passes. There is no is_guest column to
-- test. The only durable marker is auth.users.is_anonymous, mirrored into the
-- JWT as the `is_anonymous` claim.
--
-- Guests are excluded from the social layer entirely, for two reasons: an
-- anonymous session is discarded the moment it is signed out (so a friendship
-- with one is a dangling promise), and an unauthenticated account can be minted
-- on demand, which makes every rate limit below meaningless.
--
-- The exclusion is enforced at the ONE choke point that matters - guests cannot
-- claim a handle - and again on every write path, because defence that exists
-- in one place is defence that a later refactor removes.
--
-- plpgsql with dynamic SQL, not a plain SQL function, so that an environment
-- where auth.users.is_anonymous does not exist degrades to the JWT claim
-- instead of failing to create the function and taking the whole migration
-- down with it.
CREATE OR REPLACE FUNCTION public.is_guest_account(p_user UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v BOOLEAN;
BEGIN
  IF p_user IS NULL THEN
    RETURN TRUE;   -- no caller = not entitled to anything here
  END IF;
  BEGIN
    EXECUTE 'select coalesce(u.is_anonymous, false) from auth.users u where u.id = $1'
      INTO v USING p_user;
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;
  IF v IS NULL AND p_user = auth.uid() THEN
    v := COALESCE((auth.jwt() ->> 'is_anonymous')::BOOLEAN, FALSE);
  END IF;
  RETURN COALESCE(v, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.is_guest_account(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_guest_account(UUID) TO authenticated;


-- ═══ 3. CLAIMING A HANDLE ════════════════════════════════════════════════════
--
-- Allocation: student-chosen, first-come-first-served, one per account, decided
-- by the unique index rather than by a read-then-write race.
--
-- There is deliberately NO username_available() / suggest_username() endpoint.
-- Live "that handle is taken" feedback is pleasant and every consumer app has
-- it, but it is a free oracle over the whole handle space, and a handle space
-- that students will fill with their own names is a roster. Attempting a claim
-- gives an attacker exactly one bit at a time about exactly one handle they
-- typed, which is the same bit they would get from trying to sign up. That is
-- the correct amount of leakage.
CREATE OR REPLACE FUNCTION public.claim_username(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me       UUID := auth.uid();
  v_handle   TEXT := lower(btrim(coalesce(p_username, '')));
  v_previous TIMESTAMPTZ;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF public.is_guest_account(v_me) THEN
    RAISE EXCEPTION 'Create a free account to pick a handle - guest sessions cannot be added as friends.';
  END IF;
  IF v_handle !~ '^[a-z0-9_]{3,20}$' THEN
    RAISE EXCEPTION 'Handles are 3-20 characters, using a-z, 0-9 and underscore only.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.reserved_usernames r WHERE r.name = v_handle) THEN
    -- Same wording as a real collision on purpose: whether a handle is reserved
    -- or simply taken is not information a student needs.
    RAISE EXCEPTION 'That handle is taken. Try another.';
  END IF;

  SELECT p.username_set_at INTO v_previous
  FROM public.user_profiles p WHERE p.id = v_me;

  -- A 30-day cooldown on changes. Not bureaucracy: a handle other students have
  -- learned is an identity, and a free-flowing rename lets one student drop a
  -- handle their friends know and another pick it up the same minute. The
  -- residual risk (a handle released after 30 days can be claimed by someone
  -- else) is accepted and is why the UI says the change is close to permanent.
  IF v_previous IS NOT NULL
     AND v_previous > now() - INTERVAL '30 days'
     AND lower(coalesce((SELECT p.username FROM public.user_profiles p WHERE p.id = v_me), '')) <> v_handle THEN
    RAISE EXCEPTION 'You can change your handle again after %.',
      to_char(v_previous + INTERVAL '30 days', 'DD Mon YYYY');
  END IF;

  BEGIN
    UPDATE public.user_profiles
    SET username = v_handle, username_set_at = now()
    WHERE id = v_me;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That handle is taken. Try another.';
  END;

  RETURN v_handle;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_username(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_username(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.set_discoverability(p_mode TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF p_mode NOT IN ('anyone', 'nobody') THEN
    RAISE EXCEPTION 'Unknown visibility setting.';
  END IF;
  UPDATE public.user_profiles SET discoverable_by = p_mode WHERE id = v_me;
  RETURN p_mode;
END;
$$;

REVOKE ALL ON FUNCTION public.set_discoverability(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_discoverability(TEXT) TO authenticated;


-- ═══ 4. FRIENDSHIPS ══════════════════════════════════════════════════════════
--
-- One row per relationship, not two, with a canonical ordering so the pair is
-- unique regardless of who asked first.
CREATE TABLE IF NOT EXISTS public.friendships (
  -- Always the smaller uuid of the pair, enforced by ordered_pair below.
  user_a       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Overloaded on purpose, and the overload is documented rather than hidden:
  --   status='pending'  -> who sent the request
  --   status='accepted' -> who originally sent it (kept for history)
  --   status='blocked'  -> WHO BLOCKED. The delete policy depends on this: the
  --                        blocked party must not be able to delete the block
  --                        row and re-request.
  requested_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'blocked')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  PRIMARY KEY (user_a, user_b),
  CONSTRAINT friendships_ordered_pair CHECK (user_a < user_b),
  CONSTRAINT friendships_requester_is_a_party CHECK (requested_by IN (user_a, user_b))
);

-- There is NO 'declined' status, and that is a product decision as much as a
-- storage one: a tombstone lets the sender see they were declined, which is a
-- small cruelty this app does not need, and it leaves rows around forever.
-- Declining deletes the row. Re-request spam is bounded by the pending cap in
-- friend_request() instead of by permanent state.

-- The PK covers lookups by user_a. This covers the other half.
CREATE INDEX IF NOT EXISTS friendships_user_b_idx
  ON public.friendships (user_b, status);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

-- ── RLS on friendships ───────────────────────────────────────────────────────
-- The client goes through the SECURITY DEFINER functions below for every write,
-- because canonical ordering, guest checks and rate limits do not belong in a
-- policy. But the policies are still written out in full and are still the
-- security boundary: PostgREST exposes this table, so anything the policies
-- permit IS permitted, RPC or no RPC.

DROP POLICY IF EXISTS friendships_select ON public.friendships;
-- SELECT: your own relationships, nothing else.
-- Cannot over-grant: both branches pin a column of the row to auth.uid(), so
-- there is no row in the table a caller can reach that they are not a party to.
-- What it exposes about the other person is two uuids, a status and two
-- timestamps - no name, no handle, no institution, no email. Names and handles
-- come only from friend_list(), which projects them deliberately.
CREATE POLICY friendships_select ON public.friendships FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS friendships_insert ON public.friendships;
-- INSERT: you may create a PENDING request in which you are a party and you are
-- the requester.
-- Cannot over-grant, clause by clause:
--   * party check  - you cannot fabricate a relationship between two other people;
--   * requested_by - you cannot post a row that claims someone else asked you
--                    (which, with the UPDATE policy below, would let you accept it);
--   * status       - you cannot insert an already-'accepted' row and add someone
--                    unilaterally, and you cannot insert 'blocked' (blocking is
--                    RPC-only so that the blocker is always recorded);
--   * guest checks - neither party may be an anonymous account. Anonymous
--                    accounts are free to mint, so any limit that counts rows
--                    per account is worthless against one.
-- The PK on (user_a, user_b) plus the ordered_pair CHECK means this can create
-- at most one row per pair, so it is not a way to flood another student either.
CREATE POLICY friendships_insert ON public.friendships FOR INSERT
  WITH CHECK (
    (auth.uid() = user_a OR auth.uid() = user_b)
    AND auth.uid() = requested_by
    AND status = 'pending'
    AND NOT public.is_guest_account(auth.uid())
    AND NOT public.is_guest_account(CASE WHEN auth.uid() = user_a THEN user_b ELSE user_a END)
  );

DROP POLICY IF EXISTS friendships_update ON public.friendships;
-- UPDATE: the ONLY transition permitted from a client is pending -> accepted,
-- performed by the party who did NOT send the request.
--
-- `auth.uid() <> requested_by` is the whole feature. Without it a student can
-- insert a pending request naming themselves as requester and then accept it,
-- adding anybody whose uuid they know to their friends list unilaterally.
--
-- Cannot over-grant:
--   * USING pins the visible rows to ones you are a party to, that you did not
--     send, and that are still pending - so an accepted or blocked row is not
--     updatable from a client at all;
--   * WITH CHECK pins the RESULT to 'accepted' and re-asserts both party tests,
--     so this policy cannot be used to flip a row to 'blocked' (which would
--     record the wrong blocker), to reassign requested_by, or to move the row
--     to a different pair.
CREATE POLICY friendships_update ON public.friendships FOR UPDATE
  USING (
    (auth.uid() = user_a OR auth.uid() = user_b)
    AND auth.uid() <> requested_by
    AND status = 'pending'
  )
  WITH CHECK (
    (auth.uid() = user_a OR auth.uid() = user_b)
    AND auth.uid() <> requested_by
    AND status = 'accepted'
  );

DROP POLICY IF EXISTS friendships_delete ON public.friendships;
-- DELETE: either party may walk away from a pending or accepted relationship
-- (that is decline, cancel and unfriend, all three).
--
-- The second clause is a deliberate tightening over the plan's sketch: a blocked
-- row may be deleted ONLY by the blocker. Without it, blocking is decorative -
-- the blocked student deletes the row and sends a fresh request immediately.
-- Cannot over-grant: it only ever removes rows the caller is already a party to,
-- and removing a relationship can only reduce what either side can see.
CREATE POLICY friendships_delete ON public.friendships FOR DELETE
  USING (
    (auth.uid() = user_a OR auth.uid() = user_b)
    AND (status <> 'blocked' OR auth.uid() = requested_by)
  );


-- Is this pair accepted friends? SECURITY DEFINER so it can be called from
-- inside other definer functions without re-deriving the ordering.
CREATE OR REPLACE FUNCTION public.are_friends(p_one UUID, p_two UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.friendships f
    WHERE f.status = 'accepted'
      AND f.user_a = least(p_one, p_two)
      AND f.user_b = greatest(p_one, p_two)
  );
$$;

REVOKE ALL ON FUNCTION public.are_friends(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.are_friends(UUID, UUID) TO authenticated;


-- ═══ 5. FINDING A STUDENT ════════════════════════════════════════════════════
--
-- user_profiles RLS is strictly own-row ("Users view own profile"), and it must
-- stay that way: the row carries university, year, discipline and
-- personalization_background - a free-text paragraph the student wrote about
-- themselves. Widening that policy to make search work would be a serious
-- privacy regression. So search is a SECURITY DEFINER function returning a
-- deliberately chosen projection, exactly as leaderboard_top() already does.
--
-- EXACT MATCH ONLY. Not prefix, not fuzzy, not "did you mean".
--
-- A prefix endpoint (`where username like 'ade%'`) is a user-enumeration
-- endpoint wearing a friendly hat: 36 single-character queries dump most of the
-- roster, and this app's roster is identifiable medical and law students at
-- named institutions. Exact match means you can only find someone whose handle
-- you were already told - which is the same trust step as being told a phone
-- number, and is the correct trade for this product. When someone asks for a
-- nicer search experience, this is the paragraph to point at.
--
-- The negative response is uniform. No match, wrong case, handle set to
-- 'nobody', a guest account, someone who blocked you, or a string that is not
-- handle-shaped at all: ZERO ROWS, every time, with no message distinguishing
-- them. In particular an email-shaped input fails the shape guard before it
-- reaches a single comparison, so no query in this function can ever confirm or
-- deny that an address has an account.
--
-- 'friends_of_friends' is DEFERRED. It needs a two-hop traversal on every
-- keystroke-free search, and worse, it makes your findability change without
-- you doing anything, every time a friend adds someone. anyone/nobody is a
-- setting a student can predict the consequences of; the third value is not.
CREATE OR REPLACE FUNCTION public.find_student(p_handle TEXT)
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  display_name TEXT,
  points       INTEGER,
  relationship TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH needle AS (
    SELECT lower(btrim(coalesce(p_handle, ''))) AS h
  )
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    p.points,
    CASE
      WHEN p.id = auth.uid() THEN 'self'
      WHEN f.status = 'accepted' THEN 'friends'
      WHEN f.status = 'pending' AND f.requested_by = auth.uid() THEN 'pending_out'
      WHEN f.status = 'pending' THEN 'pending_in'
      ELSE 'none'
    END
  FROM public.user_profiles p
  CROSS JOIN needle n
  LEFT JOIN public.friendships f
    ON f.user_a = least(p.id, auth.uid())
   AND f.user_b = greatest(p.id, auth.uid())
  WHERE auth.uid() IS NOT NULL
    -- Shape guard first: an input that is not a legal handle can never be
    -- compared against anything, so an email is rejected before it is used.
    AND n.h ~ '^[a-z0-9_]{3,20}$'
    AND p.username IS NOT NULL
    AND lower(p.username) = n.h              -- EXACT. See the comment above.
    AND (p.discoverable_by = 'anyone' OR p.id = auth.uid())
    AND NOT public.is_guest_account(p.id)
    -- A block hides both parties from each other's search, in both directions,
    -- and is indistinguishable from "no such handle".
    AND coalesce(f.status, '') <> 'blocked'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_student(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.find_student(TEXT) TO authenticated;


-- ═══ 6. FRIENDS: LIST, REQUEST, RESPOND ══════════════════════════════════════
--
-- Rendering a friends list means showing other people's names, which
-- user_profiles RLS forbids. The plan names the two options and prefers the
-- function over denormalising names onto the friendship row; so does this. A
-- denormalised copy is cheaper and goes stale, and a stale display name on a
-- social surface is the kind of wrongness students notice.

CREATE OR REPLACE FUNCTION public.friend_list()
RETURNS TABLE (
  user_id        UUID,
  username       TEXT,
  display_name   TEXT,
  points         INTEGER,
  current_streak INTEGER,
  friends_since  TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    p.points,
    p.current_streak,
    coalesce(f.responded_at, f.created_at)
  FROM public.friendships f
  JOIN public.user_profiles p
    ON p.id = CASE WHEN f.user_a = auth.uid() THEN f.user_b ELSE f.user_a END
  WHERE auth.uid() IS NOT NULL
    AND f.status = 'accepted'
    AND (f.user_a = auth.uid() OR f.user_b = auth.uid())
  ORDER BY p.points DESC, p.username ASC;
$$;

REVOKE ALL ON FUNCTION public.friend_list() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_list() TO authenticated;


CREATE OR REPLACE FUNCTION public.friend_requests_mine()
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  display_name TEXT,
  direction    TEXT,          -- 'incoming' (you decide) | 'outgoing' (they decide)
  created_at   TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    CASE WHEN f.requested_by = auth.uid() THEN 'outgoing' ELSE 'incoming' END,
    f.created_at
  FROM public.friendships f
  JOIN public.user_profiles p
    ON p.id = CASE WHEN f.user_a = auth.uid() THEN f.user_b ELSE f.user_a END
  WHERE auth.uid() IS NOT NULL
    AND f.status = 'pending'
    AND (f.user_a = auth.uid() OR f.user_b = auth.uid())
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.friend_requests_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_requests_mine() TO authenticated;


-- Takes a HANDLE, not a uuid, so that discoverability is re-applied at send
-- time: if you could not find them a moment ago, you cannot request them now.
-- It also means the client never has to know or hold anyone else's uuid to make
-- a friend.
CREATE OR REPLACE FUNCTION public.friend_request(p_username TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me     UUID := auth.uid();
  v_them   UUID;
  v_status TEXT;
  v_pending INT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF public.is_guest_account(v_me) THEN
    RAISE EXCEPTION 'Create a free account to add friends.';
  END IF;

  -- Reuses find_student, so there is exactly ONE definition of who is findable
  -- and one uniform failure. A second lookup here would be a second place for
  -- the privacy rules to drift out of agreement.
  SELECT s.user_id INTO v_them FROM public.find_student(p_username) s;
  IF v_them IS NULL THEN
    RAISE EXCEPTION 'No student found with that handle.';
  END IF;
  IF v_them = v_me THEN
    RAISE EXCEPTION 'That is your own handle.';
  END IF;

  SELECT f.status INTO v_status
  FROM public.friendships f
  WHERE f.user_a = least(v_me, v_them) AND f.user_b = greatest(v_me, v_them);

  IF v_status = 'accepted' THEN
    RETURN 'friends';
  ELSIF v_status = 'pending' THEN
    RETURN 'pending';
  ELSIF v_status = 'blocked' THEN
    -- Unreachable: find_student already returned nothing for a blocked pair.
    -- Kept so a future change to that function cannot silently open a channel.
    RAISE EXCEPTION 'No student found with that handle.';
  END IF;

  -- Bounds the damage one account can do before anyone accepts anything. 25 is
  -- far more than a real student has outstanding and far less than a useful
  -- spam run.
  SELECT count(*) INTO v_pending
  FROM public.friendships f
  WHERE f.status = 'pending' AND f.requested_by = v_me;
  IF v_pending >= 25 THEN
    RAISE EXCEPTION 'You have too many friend requests waiting. Wait for some to be answered first.';
  END IF;

  INSERT INTO public.friendships (user_a, user_b, requested_by, status)
  VALUES (least(v_me, v_them), greatest(v_me, v_them), v_me, 'pending');

  RETURN 'sent';
END;
$$;

REVOKE ALL ON FUNCTION public.friend_request(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_request(TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.friend_respond(p_user_id UUID, p_accept BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_a  UUID;
  v_b  UUID;
  v_n  INT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  v_a := least(v_me, p_user_id);
  v_b := greatest(v_me, p_user_id);

  IF p_accept THEN
    -- The `requested_by <> v_me` predicate is the same rule the UPDATE policy
    -- enforces, restated here because this function is SECURITY DEFINER and
    -- therefore does NOT run under that policy. A definer function that forgets
    -- to re-assert its table's policy is how a policy gets quietly bypassed.
    UPDATE public.friendships
    SET status = 'accepted', responded_at = now()
    WHERE user_a = v_a AND user_b = v_b
      AND status = 'pending'
      AND requested_by <> v_me
      AND (user_a = v_me OR user_b = v_me);
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN
      RAISE EXCEPTION 'That request is no longer waiting for you.';
    END IF;
    RETURN 'accepted';
  END IF;

  -- Decline deletes. No tombstone, so the sender is never shown a refusal.
  DELETE FROM public.friendships
  WHERE user_a = v_a AND user_b = v_b
    AND status = 'pending'
    AND (user_a = v_me OR user_b = v_me);
  RETURN 'declined';
END;
$$;

REVOKE ALL ON FUNCTION public.friend_respond(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_respond(UUID, BOOLEAN) TO authenticated;


CREATE OR REPLACE FUNCTION public.friend_remove(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  -- Re-asserts the DELETE policy's blocked-row rule for the same reason as above.
  DELETE FROM public.friendships
  WHERE user_a = least(v_me, p_user_id)
    AND user_b = greatest(v_me, p_user_id)
    AND (user_a = v_me OR user_b = v_me)
    AND (status <> 'blocked' OR requested_by = v_me);
  RETURN 'removed';
END;
$$;

REVOKE ALL ON FUNCTION public.friend_remove(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_remove(UUID) TO authenticated;


-- Blocking is RPC-only by design: no policy permits creating or updating a
-- 'blocked' row, because the row has to record WHO blocked and a client-supplied
-- requested_by on a blocked row would let the blocked party name themselves as
-- the blocker and then delete it.
--
-- A block also cancels every unresolved challenge between the pair. The plan
-- warns that the surface where a blocked person reappears is the one everybody
-- forgets; here that surface is the challenge list.
CREATE OR REPLACE FUNCTION public.friend_block(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_a  UUID;
  v_b  UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF p_user_id = v_me THEN
    RAISE EXCEPTION 'You cannot block yourself.';
  END IF;
  v_a := least(v_me, p_user_id);
  v_b := greatest(v_me, p_user_id);

  INSERT INTO public.friendships (user_a, user_b, requested_by, status, responded_at)
  VALUES (v_a, v_b, v_me, 'blocked', now())
  ON CONFLICT (user_a, user_b) DO UPDATE
    SET status = 'blocked', requested_by = v_me, responded_at = now();

  UPDATE public.challenges
  SET status = 'expired', resolved_at = now()
  WHERE status IN ('pending', 'active')
    AND ((challenger = v_me AND opponent = p_user_id)
      OR (challenger = p_user_id AND opponent = v_me));

  RETURN 'blocked';
END;
$$;

REVOKE ALL ON FUNCTION public.friend_block(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_block(UUID) TO authenticated;


-- ═══ 7. ASYNCHRONOUS CHALLENGES ══════════════════════════════════════════════
--
-- A challenges B on a set of questions; each plays it whenever they like; when
-- both have finished (or the deadline passes) the result resolves. No realtime,
-- no shared clock, no requirement that the two are awake at the same minute -
-- which, as the plan observes, is the mode two medical students can actually use.
--
-- THE QUESTION SET IS GENERATED ONCE. Generating separately per player means
-- comparing scores on different questions, which is not a contest. It also means
-- a challenge costs the same in AI spend as one ordinary practice set.

CREATE TABLE IF NOT EXISTS public.challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Denormalised onto this row rather than read from challenge_participants, so
  -- the SELECT policy below needs no subquery. A policy on challenges that
  -- queried challenge_participants, whose own policy queried challenges, is a
  -- mutual recursion Postgres will refuse at runtime rather than at creation -
  -- i.e. it fails in production, not in review.
  title          TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 80),
  question_count SMALLINT NOT NULL CHECK (question_count BETWEEN 1 AND 12),
  -- The session the questions were generated into. The challenger plays this one
  -- directly; the opponent gets a server-made copy (see challenge_begin).
  source_session_id UUID REFERENCES public.study_sessions(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'active', 'complete', 'expired', 'declined')),
  -- NULL on a complete challenge means a DRAW. Draws must be renderable; on a
  -- short MCQ set between two prepared students they are common, not exotic.
  winner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  CONSTRAINT challenges_distinct_players CHECK (challenger <> opponent)
);

CREATE INDEX IF NOT EXISTS challenges_challenger_idx ON public.challenges (challenger, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_opponent_idx   ON public.challenges (opponent, created_at DESC);
CREATE INDEX IF NOT EXISTS challenges_open_idx       ON public.challenges (expires_at)
  WHERE status IN ('pending', 'active');

-- One row per player. This is the RESULT table, and it is the whole of what a
-- challenge durably costs: no per-question stream, no transcript, no answer
-- copies. Small integers and timestamps, as §2 of the plan requires.
CREATE TABLE IF NOT EXISTS public.challenge_participants (
  challenge_id UUID NOT NULL REFERENCES public.challenges(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- This player's own study_sessions row for the set.
  session_id   UUID REFERENCES public.study_sessions(id) ON DELETE SET NULL,
  -- BOTH of these are stamped with the SERVER's now(), never with a value the
  -- client supplies, and duration_ms is computed from them here rather than
  -- accepted from a device. Two devices' clocks disagree by minutes routinely,
  -- and a client-reported duration is not merely inaccurate, it is a number the
  -- client chooses. Since duration is the tie-break, that would decide contests.
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  score        SMALLINT,       -- correct answers, recounted server-side
  answered     SMALLINT,
  duration_ms  INTEGER,        -- finished_at - started_at, both server-stamped
  PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS challenge_participants_user_idx
  ON public.challenge_participants (user_id);
-- Serves challenge_submit_for_session(): "which participation is this session?"
CREATE UNIQUE INDEX IF NOT EXISTS challenge_participants_session_idx
  ON public.challenge_participants (session_id)
  WHERE session_id IS NOT NULL;

ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.challenge_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS challenges_select ON public.challenges;
-- SELECT: the two players, nobody else.
-- Cannot over-grant: both branches pin a column of the row to auth.uid(). There
-- is no join, no subquery and therefore no second table whose policy could be
-- the weak link. It exposes a title, a count, a status and timestamps - and the
-- opponent's uuid, which the caller already had, since they are in a challenge
-- with them.
CREATE POLICY challenges_select ON public.challenges FOR SELECT
  USING (auth.uid() = challenger OR auth.uid() = opponent);

DROP POLICY IF EXISTS challenge_participants_select ON public.challenge_participants;
-- SELECT: your OWN result row only - deliberately not your opponent's.
--
-- Not paranoia about the data (a score is not a secret) but about fairness:
-- knowing the target before you sit down changes how you play, and a policy that
-- hands you the opponent's score the moment they finish is a policy that makes
-- going second better than going first. The opponent's score is released by
-- challenge_list_mine() once YOU have finished or the challenge has resolved -
-- one rule, in one function, that can be read in one place.
--
-- Cannot over-grant: user_id = auth.uid() is the entire predicate.
CREATE POLICY challenge_participants_select ON public.challenge_participants FOR SELECT
  USING (auth.uid() = user_id);

-- NO INSERT, UPDATE OR DELETE POLICY ON EITHER TABLE, FOR ANY ROLE.
--
-- With RLS enabled and no write policy, these tables are write-proof from the
-- client: PostgREST will reject the statement no matter what it contains. Every
-- write below happens inside a SECURITY DEFINER function that recomputes the
-- value it is about to store.
--
-- This is not defence in depth, it is the ONLY defence that works here. Any
-- client-writable score column is a score the player sets; any client-writable
-- finished_at is a tie-break the player wins. There is no WITH CHECK expression
-- that can tell a true score from a false one, because the truth is not in the
-- row being written - it is in study_answers, and the server has to go and count
-- it. So the table takes no client writes at all.


-- Recount a player's score from what is actually stored. This is the function
-- that makes a challenge result mean something.
--
-- MCQ ONLY, and that is why challenges are MCQ-only: an MCQ has a stored key
-- (study_questions.correct_answer) that the server can compare against the
-- stored answer itself. An essay's correctness exists only as a judgement the
-- AI made and the CLIENT wrote into study_answers.is_correct - i.e. a number the
-- player's browser chose. Scoring a contest on that is scoring it on a claim.
--
-- Note it does not read study_answers.is_correct or .score at all, for exactly
-- the same reason: those columns are written by the client too.
--
-- HONEST LIMIT, stated here because it is the reason §8 pays no points: the
-- practice screen loads correct_answer into the browser in order to grade MCQs
-- on-device, as it has always done. A student who opens devtools can read the
-- key before answering. This function guarantees the score matches the answers
-- that were submitted; it cannot guarantee the answers were not looked up. That
-- is unchanged from ordinary practice, and it is fine for a result - it is not
-- fine for a point total, which is why no points are awarded.
CREATE OR REPLACE FUNCTION public.challenge_score_session(p_session_id UUID)
RETURNS TABLE (correct SMALLINT, answered SMALLINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- DISTINCT ON: study_answers has no unique key on (session_id, question_id),
  -- so a double submit could leave two rows for one question. Take the latest.
  WITH latest AS (
    SELECT DISTINCT ON (a.question_id) a.question_id, a.answer
    FROM public.study_answers a
    WHERE a.session_id = p_session_id
    ORDER BY a.question_id, a.created_at DESC
  )
  SELECT
    (count(*) FILTER (
      WHERE lower(btrim(l.answer)) = lower(btrim(q.correct_answer))
    ))::SMALLINT,
    (count(*))::SMALLINT
  FROM latest l
  JOIN public.study_questions q ON q.id = l.question_id
  WHERE q.question_type = 'mcq';
$$;

REVOKE ALL ON FUNCTION public.challenge_score_session(UUID) FROM PUBLIC, anon, authenticated;


-- Resolve a challenge. Idempotent, because both players' clients will call it,
-- possibly at the same moment.
--
-- Score decides. Equal score -> lower duration_ms wins. Equal both -> draw.
CREATE OR REPLACE FUNCTION public.challenge_resolve(p_challenge_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c            public.challenges%ROWTYPE;
  v_done       INT;
  v_total      INT;
  v_winner     UUID;
BEGIN
  SELECT * INTO c FROM public.challenges WHERE id = p_challenge_id FOR UPDATE;
  IF c.id IS NULL THEN
    RETURN 'missing';
  END IF;
  IF c.status IN ('complete', 'expired', 'declined') THEN
    RETURN c.status;      -- already settled; never re-decide a finished contest
  END IF;

  SELECT count(*) FILTER (WHERE p.finished_at IS NOT NULL), count(*)
    INTO v_done, v_total
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id;

  IF v_done < v_total THEN
    IF now() < c.expires_at THEN
      RETURN c.status;    -- still waiting on somebody, and there is still time
    END IF;
    -- Deadline passed with someone unplayed. Expire it with NO winner. Awarding
    -- the win to whoever showed up would make "challenge someone who is busy"
    -- a strategy, and there is nothing to award anyway.
    UPDATE public.challenges
    SET status = 'expired', resolved_at = now()
    WHERE id = c.id;
    RETURN 'expired';
  END IF;

  SELECT p.user_id INTO v_winner
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id
  ORDER BY p.score DESC NULLS LAST, p.duration_ms ASC NULLS LAST
  LIMIT 1;

  -- A draw is a real outcome, not a failure to pick: identical score AND
  -- identical duration_ms. duration_ms is milliseconds of server time, so this
  -- is vanishingly rare in practice - but "vanishingly rare" is exactly the
  -- branch that ships broken, so it is written and the UI renders it.
  IF (
    SELECT count(DISTINCT (p.score, p.duration_ms))
    FROM public.challenge_participants p
    WHERE p.challenge_id = c.id
  ) = 1 THEN
    v_winner := NULL;
  END IF;

  UPDATE public.challenges
  SET status = 'complete', winner_user_id = v_winner, resolved_at = now()
  WHERE id = c.id;

  RETURN 'complete';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_resolve(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_resolve(UUID) TO authenticated;


-- Create a challenge from a question set the caller has just generated.
--
-- The set must be VIRGIN: in progress, with no answers. Otherwise the challenger
-- would be sending a set they have already seen the answers to, which is not a
-- contest, and no amount of server-side scoring fixes it.
CREATE OR REPLACE FUNCTION public.challenge_create(
  p_opponent_username TEXT,
  p_session_id        UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me      UUID := auth.uid();
  v_them    UUID;
  v_title   TEXT;
  v_count   INT;
  v_nonmcq  INT;
  v_answers INT;
  v_open    INT;
  v_status  TEXT;
  v_id      UUID;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF public.is_guest_account(v_me) THEN
    RAISE EXCEPTION 'Create a free account to challenge a friend.';
  END IF;

  SELECT s.user_id INTO v_them FROM public.find_student(p_opponent_username) s;
  IF v_them IS NULL OR v_them = v_me THEN
    RAISE EXCEPTION 'No student found with that handle.';
  END IF;
  IF NOT public.are_friends(v_me, v_them) THEN
    -- Challenges are friends-only. An unsolicited challenge from a stranger is
    -- a notification channel, and a notification channel is a spam channel.
    RAISE EXCEPTION 'You can only challenge students on your friends list.';
  END IF;

  -- The session must be the caller's own, unplayed, and made of MCQs.
  SELECT ss.status INTO v_status
  FROM public.study_sessions ss
  WHERE ss.id = p_session_id AND ss.user_id = v_me;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'That question set could not be found.';
  END IF;
  IF v_status <> 'in_progress' THEN
    RAISE EXCEPTION 'That set has already been played. Make a fresh one to challenge with.';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE q.question_type <> 'mcq')
    INTO v_count, v_nonmcq
  FROM public.study_questions q WHERE q.session_id = p_session_id;

  IF v_count = 0 THEN
    RAISE EXCEPTION 'That question set is empty.';
  END IF;
  IF v_nonmcq > 0 THEN
    RAISE EXCEPTION 'Challenges use multiple-choice questions only, so both scores are settled the same way.';
  END IF;
  IF v_count > 12 THEN
    -- Bounds the copied set (see challenge_begin) and therefore bounds the whole
    -- feature's storage. Also: a 40-question challenge is not one anybody
    -- finishes on a phone between lectures.
    RAISE EXCEPTION 'Challenges are up to 12 questions.';
  END IF;

  SELECT count(*) INTO v_answers
  FROM public.study_answers a WHERE a.session_id = p_session_id;
  IF v_answers > 0 THEN
    RAISE EXCEPTION 'That set has already been answered. Make a fresh one to challenge with.';
  END IF;

  -- Answers are only written to study_answers on submit; an abandoned sitting
  -- leaves its work in the session's feedback JSONB as `draftAnswers`. Without
  -- this check a challenger could answer the whole set in Learning mode (which
  -- grades each question as it is picked), walk away, and then send the set they
  -- have already seen the answers to.
  -- jsonb_exists(), not the `?` operator: this file gets pasted into SQL
  -- consoles and driven by drivers that treat a bare `?` as a bind placeholder.
  -- The function form means exactly the same thing and survives all of them.
  IF EXISTS (
    SELECT 1 FROM public.study_sessions ss
    WHERE ss.id = p_session_id AND jsonb_exists(ss.feedback, 'draftAnswers')
  ) THEN
    RAISE EXCEPTION 'That set has already been started. Make a fresh one to challenge with.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.challenges c WHERE c.source_session_id = p_session_id) THEN
    RAISE EXCEPTION 'That set has already been sent as a challenge.';
  END IF;

  -- Bounds spam AND storage in one rule: at most 3 unresolved challenges from
  -- this student to this friend at a time.
  SELECT count(*) INTO v_open
  FROM public.challenges c
  WHERE c.challenger = v_me AND c.opponent = v_them
    AND c.status IN ('pending', 'active');
  IF v_open >= 3 THEN
    RAISE EXCEPTION 'You already have 3 challenges waiting with this friend.';
  END IF;

  SELECT left(coalesce(nullif(btrim(t.title), ''), 'Challenge'), 80) INTO v_title
  FROM public.study_sessions ss
  JOIN public.study_topics t ON t.id = ss.topic_id
  WHERE ss.id = p_session_id;

  INSERT INTO public.challenges
    (challenger, opponent, title, question_count, source_session_id, status, expires_at)
  VALUES
    (v_me, v_them, coalesce(v_title, 'Challenge'), v_count, p_session_id, 'pending',
     -- Seven days. The plan is right that abandonment, not cheating, is what
     -- kills this feature; a deadline plus the sweep below is the difference
     -- between a feature and a graveyard of pending invitations.
     now() + INTERVAL '7 days')
  RETURNING id INTO v_id;

  INSERT INTO public.challenge_participants (challenge_id, user_id, session_id)
  VALUES (v_id, v_me, p_session_id), (v_id, v_them, NULL);

  -- Put the challenger's own sitting on the same footing as the copy the
  -- opponent will get: Exam mode, answered and submitted in one go. Otherwise
  -- the challenger plays in Learning mode, which reveals each answer as it is
  -- picked, and the two are not doing the same thing.
  UPDATE public.study_sessions ss
  SET feedback = coalesce(ss.feedback, '{}'::jsonb)
                 || jsonb_build_object('mode', 'exam', 'challenge_id', v_id)
  WHERE ss.id = p_session_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_create(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_create(TEXT, UUID) TO authenticated;


-- Start (or resume) a player's sitting. Returns the session to open.
--
-- HOW THE SHARED SET IS SHARED, AND WHY IT IS A COPY
-- --------------------------------------------------
-- The plan (§5) lists three options and recommends adding challenge_id to
-- study_questions and widening its RLS policy. This does the other one - a
-- server-made copy into the opponent's own session - and the reason is specific
-- to this repo rather than a disagreement about elegance:
--
--   * The mobile Capacitor app ships SEPARATELY from the web app and reads
--     study_questions by session_id. Under the shared-row design a challenge is
--     not playable on mobile until a new mobile build reaches every student;
--     under this one a challenge session is an ordinary session and mobile plays
--     it today, with no mobile change at all. The dedup migration made the same
--     call for the same reason.
--   * study_questions' policy is `FOR ALL USING (auth.uid() = user_id)` - one
--     policy covering every verb on the hottest table in the app. Splitting it
--     into four to widen only SELECT is a change to the core practice path, and
--     the whole point of the flag is to keep the core path untouched.
--   * The practice screen needs no branch, so there is one code path for playing
--     questions rather than two.
--
-- The cost is real and is not hidden: one duplicate question set per challenge,
-- ~1 KB per question. See the storage note at the foot of this file, including
-- the point at which this has to change.
--
-- source_refs are deliberately NOT copied. They name the challenger's own file
-- and folder names, and which textbooks a student has uploaded is not something
-- to hand to another student as a side effect of a quiz.
CREATE OR REPLACE FUNCTION public.challenge_begin(p_challenge_id UUID)
RETURNS TABLE (session_id UUID, plan_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
-- The directive above is deliberately the first thing in the body (plpgsql only
-- accepts it there). This function's OUT parameters are named session_id and
-- plan_id, which are also column names on tables it writes to. Every reference
-- below is already table-qualified, but a later edit that forgets to qualify one
-- would fail at RUN time with "column reference is ambiguous" - i.e. in
-- production, not in review. This makes the column win, which is the right
-- answer every time here: all the locals are v_-prefixed and can never clash.
DECLARE
  c          public.challenges%ROWTYPE;
  v_me       UUID := auth.uid();
  v_session  UUID;
  v_plan     UUID;
  v_topic    UUID;
  v_started  TIMESTAMPTZ;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;

  SELECT * INTO c FROM public.challenges WHERE id = p_challenge_id;
  IF c.id IS NULL OR v_me NOT IN (c.challenger, c.opponent) THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;
  IF c.status IN ('complete', 'expired', 'declined') THEN
    RAISE EXCEPTION 'That challenge is over.';
  END IF;
  IF now() >= c.expires_at THEN
    PERFORM public.challenge_resolve(c.id);
    RAISE EXCEPTION 'That challenge has expired.';
  END IF;

  SELECT p.session_id, p.started_at INTO v_session, v_started
  FROM public.challenge_participants p
  WHERE p.challenge_id = c.id AND p.user_id = v_me
  FOR UPDATE;

  IF v_session IS NULL THEN
    -- The opponent's copy. Its own plan and topic, so the practice screen's
    -- mastery bookkeeping has somewhere of its own to write and never touches
    -- the challenger's roadmap.
    INSERT INTO public.study_plans
      (user_id, title, course_outline, source_type, source_document_ids, preference_snapshot)
    VALUES
      (v_me, c.title, '', 'generated', '{}'::uuid[],
       -- Marks the plan as a challenge copy so
       -- purge_challenge_question_copies() can find it later without guessing.
       jsonb_build_object('challenge_copy', true, 'challenge_id', c.id))
    RETURNING id INTO v_plan;

    INSERT INTO public.study_topics
      (user_id, plan_id, title, summary, objectives, source_refs, position, status)
    VALUES
      (v_me, v_plan, c.title, 'A challenge set from a friend.',
       '[]'::jsonb, '[]'::jsonb, 0, 'practicing')
    RETURNING id INTO v_topic;

    INSERT INTO public.study_sessions
      (user_id, plan_id, topic_id, question_type, requested_count, total_questions, feedback)
    VALUES
      (v_me, v_plan, v_topic, 'mcq', c.question_count, c.question_count,
       -- 'exam' so the whole set is answered and submitted in one sitting, which
       -- is what makes the single server-stamped finish time meaningful.
       jsonb_build_object('mode', 'exam', 'challenge_id', c.id))
    RETURNING id INTO v_session;

    INSERT INTO public.study_questions
      (user_id, session_id, plan_id, topic_id, question_type, prompt, options,
       correct_answer, explanation, rubric, difficulty, source_refs, position)
    SELECT
      v_me, v_session, v_plan, v_topic, q.question_type, q.prompt, q.options,
      q.correct_answer, q.explanation, q.rubric, q.difficulty,
      '[]'::jsonb,          -- see the note above: no file names cross accounts
      q.position
    FROM public.study_questions q
    WHERE q.session_id = c.source_session_id
    ORDER BY q.position;
  ELSE
    SELECT ss.plan_id INTO v_plan FROM public.study_sessions ss WHERE ss.id = v_session;
  END IF;

  UPDATE public.challenge_participants p
  SET session_id = v_session,
      -- Stamped ONCE, by the server, on first open. Re-opening does not restart
      -- the clock, so leaving and coming back costs you rather than resetting
      -- your time - the same direction of error as everything else here.
      started_at = coalesce(p.started_at, now())
  WHERE p.challenge_id = c.id AND p.user_id = v_me;

  UPDATE public.challenges SET status = 'active'
  WHERE id = c.id AND status = 'pending';

  RETURN QUERY SELECT v_session, v_plan;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_begin(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_begin(UUID) TO authenticated;


-- The internal finisher. Recounts, stamps, resolves. Idempotent.
CREATE OR REPLACE FUNCTION public.challenge_finish_participant(
  p_challenge_id UUID,
  p_user_id      UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   UUID;
  v_started   TIMESTAMPTZ;
  v_finished  TIMESTAMPTZ;
  v_status    TEXT;
  v_correct   SMALLINT;
  v_answered  SMALLINT;
BEGIN
  SELECT p.session_id, p.started_at, p.finished_at
    INTO v_session, v_started, v_finished
  FROM public.challenge_participants p
  WHERE p.challenge_id = p_challenge_id AND p.user_id = p_user_id
  FOR UPDATE;

  IF v_session IS NULL THEN
    RETURN 'not_started';
  END IF;
  IF v_finished IS NOT NULL THEN
    RETURN 'already_finished';   -- never re-stamp; the first time is the time
  END IF;

  SELECT ss.status INTO v_status FROM public.study_sessions ss WHERE ss.id = v_session;
  IF v_status IS DISTINCT FROM 'completed' THEN
    RETURN 'in_progress';
  END IF;

  SELECT s.correct, s.answered INTO v_correct, v_answered
  FROM public.challenge_score_session(v_session) s;

  UPDATE public.challenge_participants p
  SET finished_at = now(),
      score       = coalesce(v_correct, 0),
      answered    = coalesce(v_answered, 0),
      -- Server clock minus server clock. Never a client-supplied elapsed time,
      -- and never study_sessions.completed_at, which the browser writes from
      -- Date.now(). Clamped at 0 in case started_at was somehow set later.
      duration_ms = greatest(0, (extract(EPOCH FROM (now() - coalesce(v_started, now()))) * 1000)::BIGINT)
                      ::INTEGER
  WHERE p.challenge_id = p_challenge_id AND p.user_id = p_user_id;

  PERFORM public.challenge_resolve(p_challenge_id);
  RETURN 'finished';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_finish_participant(UUID, UUID) FROM PUBLIC, anon, authenticated;


-- Called by the practice screen the instant a set is submitted, so the
-- server-stamped finish time is within a second of the real one.
--
-- Takes a SESSION id because that is what the practice screen has; the
-- participation is looked up from it, and the unique index on
-- challenge_participants(session_id) makes that lookup exact. Returns NULL for
-- an ordinary practice session, which is the overwhelmingly common case, so the
-- screen can call it unconditionally.
CREATE OR REPLACE FUNCTION public.challenge_submit_for_session(p_session_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me        UUID := auth.uid();
  v_challenge UUID;
BEGIN
  IF v_me IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.challenge_id INTO v_challenge
  FROM public.challenge_participants p
  WHERE p.session_id = p_session_id AND p.user_id = v_me;
  IF v_challenge IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN public.challenge_finish_participant(v_challenge, v_me);
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_submit_for_session(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_submit_for_session(UUID) TO authenticated;


-- The recovery path, called when the challenge list is opened. If the submit
-- above never reached the server (a dropped connection on a lecture-hall
-- network, a killed tab), the result is still recoverable from the stored
-- answers - it is only the stamp that is late.
--
-- A late stamp inflates duration_ms, so it can only ever COST the player who
-- failed to submit promptly. That asymmetry is the reason this fallback is safe
-- to have at all: there is no version of "forget to submit" that wins a
-- tie-break it would otherwise have lost.
CREATE OR REPLACE FUNCTION public.challenge_submit(p_challenge_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.challenge_participants p
    WHERE p.challenge_id = p_challenge_id AND p.user_id = v_me
  ) THEN
    RAISE EXCEPTION 'Challenge not found.';
  END IF;
  RETURN public.challenge_finish_participant(p_challenge_id, v_me);
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_submit(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_submit(UUID) TO authenticated;


-- Decline (opponent) / cancel (challenger). Both delete nothing but the row's
-- future: the row itself is kept as history until the purge takes it.
CREATE OR REPLACE FUNCTION public.challenge_decline(p_challenge_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_n  INT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  UPDATE public.challenges
  SET status = 'declined', resolved_at = now()
  WHERE id = p_challenge_id
    AND opponent = v_me
    AND status = 'pending';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'That challenge cannot be declined any more.';
  END IF;
  RETURN 'declined';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_decline(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_decline(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.challenge_cancel(p_challenge_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  v_n  INT;
BEGIN
  IF v_me IS NULL THEN
    RAISE EXCEPTION 'Sign in first.';
  END IF;
  -- Only before the opponent has started. Once they have sat down, withdrawing
  -- because you are losing is exactly the behaviour not to make available.
  DELETE FROM public.challenges c
  WHERE c.id = p_challenge_id
    AND c.challenger = v_me
    AND c.status = 'pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.challenge_participants p
      WHERE p.challenge_id = c.id AND p.user_id = c.opponent AND p.started_at IS NOT NULL
    );
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'That challenge has already started and cannot be withdrawn.';
  END IF;
  RETURN 'cancelled';
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_cancel(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_cancel(UUID) TO authenticated;


-- Everything the challenge screen renders, in one call: the caller's side, the
-- opponent's identity, and the opponent's result ONLY when the caller is
-- entitled to it.
--
-- The release rule lives here and only here: an opponent's score and time are
-- returned once the caller has finished their own sitting, or once the challenge
-- has settled. Before that they are NULL - not omitted from some code paths and
-- present in others, which is how this kind of rule usually leaks.
--
-- It also sweeps: any of the caller's own participations whose session is
-- finished but whose result was never stamped get finished here (see
-- challenge_submit above for why a late stamp is safe), and anything past its
-- deadline is resolved. That makes opening the list the recovery mechanism, so
-- there is no scheduled job to forget to set up.
CREATE OR REPLACE FUNCTION public.challenge_list_mine(p_limit INT DEFAULT 40)
RETURNS TABLE (
  id                UUID,
  title             TEXT,
  question_count    SMALLINT,
  status            TEXT,
  i_am_challenger   BOOLEAN,
  opponent_user_id  UUID,
  opponent_username TEXT,
  opponent_name     TEXT,
  my_score          SMALLINT,
  my_duration_ms    INTEGER,
  my_finished_at    TIMESTAMPTZ,
  my_started        BOOLEAN,
  their_score       SMALLINT,
  their_duration_ms INTEGER,
  their_finished    BOOLEAN,
  outcome           TEXT,      -- 'won' | 'lost' | 'draw' | null while unsettled
  expires_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
BEGIN
  IF v_me IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH mine AS (
    SELECT c.*
    FROM public.challenges c
    WHERE c.challenger = v_me OR c.opponent = v_me
    ORDER BY c.created_at DESC
    LIMIT greatest(1, least(coalesce(p_limit, 40), 100))
  )
  SELECT
    m.id,
    m.title,
    m.question_count,
    m.status,
    (m.challenger = v_me),
    CASE WHEN m.challenger = v_me THEN m.opponent ELSE m.challenger END,
    op.username,
    coalesce(nullif(btrim(op.name), ''), 'Student'),
    me.score,
    me.duration_ms,
    me.finished_at,
    (me.started_at IS NOT NULL),
    -- The release rule. Both columns are gated by the same condition, so there
    -- is no path where one leaks without the other.
    CASE WHEN me.finished_at IS NOT NULL OR m.status = 'complete' THEN them.score END,
    CASE WHEN me.finished_at IS NOT NULL OR m.status = 'complete' THEN them.duration_ms END,
    (them.finished_at IS NOT NULL),
    CASE
      WHEN m.status <> 'complete' THEN NULL
      WHEN m.winner_user_id IS NULL THEN 'draw'
      WHEN m.winner_user_id = v_me THEN 'won'
      ELSE 'lost'
    END,
    m.expires_at,
    m.created_at,
    m.resolved_at
  FROM mine m
  JOIN public.challenge_participants me
    ON me.challenge_id = m.id AND me.user_id = v_me
  JOIN public.challenge_participants them
    ON them.challenge_id = m.id AND them.user_id <> v_me
  JOIN public.user_profiles op
    ON op.id = CASE WHEN m.challenger = v_me THEN m.opponent ELSE m.challenger END
  ORDER BY m.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_list_mine(INT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_list_mine(INT) TO authenticated;


-- Sweep the caller's own unstamped and overdue challenges. Called before
-- challenge_list_mine() by the client; kept separate because list_mine is STABLE
-- (it cannot write) and this one must.
CREATE OR REPLACE FUNCTION public.challenge_sync_mine()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_me UUID := auth.uid();
  r    RECORD;
  n    INT := 0;
BEGIN
  IF v_me IS NULL THEN
    RETURN 0;
  END IF;

  FOR r IN
    SELECT p.challenge_id
    FROM public.challenge_participants p
    JOIN public.challenges c ON c.id = p.challenge_id
    JOIN public.study_sessions ss ON ss.id = p.session_id
    WHERE p.user_id = v_me
      AND p.finished_at IS NULL
      AND ss.status = 'completed'
      AND c.status IN ('pending', 'active')
  LOOP
    PERFORM public.challenge_finish_participant(r.challenge_id, v_me);
    n := n + 1;
  END LOOP;

  FOR r IN
    SELECT c.id
    FROM public.challenges c
    WHERE (c.challenger = v_me OR c.opponent = v_me)
      AND c.status IN ('pending', 'active')
      AND now() >= c.expires_at
  LOOP
    PERFORM public.challenge_resolve(r.id);
    n := n + 1;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.challenge_sync_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.challenge_sync_mine() TO authenticated;


-- ═══ 8. RETENTION ════════════════════════════════════════════════════════════
--
-- STORAGE, WITH THE ARITHMETIC, because this instance has ~95 MB of headroom on
-- a 500 MB free tier and the plan rejected live PvP over exactly this.
--
-- Per challenge, the rows THIS migration adds:
--   challenges              ~300 B  (incl. its three indexes)
--   challenge_participants  ~180 B x 2 = 360 B
--                           -------------------
--                           ~660 B per challenge
--
-- Per challenge, the rows PLAYING it adds to the existing study_* tables:
--   the opponent's copied question set   N x ~1.0 KB  (8 questions -> ~8 KB)
--   the opponent's plan + topic + session          ~0.7 KB
--   the opponent's answers               N x ~0.4 KB  (8 -> ~3.2 KB)
--                           -------------------
--                           ~12 KB per challenge at N=8
--
-- Per student per month, assuming each student takes part in two challenges a
-- month (one they send, one they receive):
--   social schema:  1 x 660 B                       =  0.7 KB
--   study_* rows:   1 received challenge x ~12 KB   = 12   KB
--                           -------------------
--                           ~12.7 KB / student / month
--
-- At 2,000 students that is ~25 MB a month, of which only ~1.3 MB is the social
-- schema. THE COPIED QUESTION SETS ARE THE WHOLE COST. Concretely: this design
-- is comfortable to roughly 8,000 played challenges before it has eaten the
-- headroom, which at 200 active students is about two years and at 2,000 is
-- about four months.
--
-- The trigger to change it is therefore a challenge count, not a student count.
-- Past ~8,000 played challenges, move to the plan's option (2): add challenge_id
-- to study_questions, widen its SELECT policy to participants, and have
-- challenge_begin() link instead of copy. That takes the 12 KB to ~1 KB and is a
-- change to this one function plus the practice screen's question query.
--
-- Until then, the two levers below.

-- Lever 1, safe and routine: drop settled challenge ROWS after 90 days. Touches
-- nothing a student would recognise as their own work.
CREATE OR REPLACE FUNCTION public.purge_old_challenges(p_days INT DEFAULT 90)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INT;
BEGIN
  DELETE FROM public.challenges c
  WHERE c.status IN ('complete', 'expired', 'declined')
    AND coalesce(c.resolved_at, c.created_at) < now() - make_interval(days => greatest(1, p_days));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_old_challenges(INT) FROM PUBLIC, anon, authenticated;

-- Lever 2, DESTRUCTIVE and deliberately not automatic: delete the duplicated
-- question sets. A challenge copy is, from the student's side, an ordinary
-- practice set in their history - deleting it removes something they did. Run
-- this only when storage actually demands it, and tell students first.
--
-- It finds copies by the marker challenge_begin() writes, so it can never take
-- an ordinary plan by accident. The cascade removes the topic, session,
-- questions and answers with it.
CREATE OR REPLACE FUNCTION public.purge_challenge_question_copies(p_days INT DEFAULT 180)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n INT;
BEGIN
  DELETE FROM public.study_plans sp
  WHERE sp.preference_snapshot ->> 'challenge_copy' = 'true'
    AND sp.created_at < now() - make_interval(days => greatest(30, p_days));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_challenge_question_copies(INT) FROM PUBLIC, anon, authenticated;


COMMENT ON TABLE public.friendships IS
  'One row per pair, user_a < user_b. requested_by = requester while pending, blocker while blocked. Declining deletes the row; there is no declined status.';
COMMENT ON TABLE public.challenges IS
  'Asynchronous friend challenges on a shared MCQ set. No realtime, no live PvP. Result only - no per-question events.';
COMMENT ON TABLE public.challenge_participants IS
  'Per-player result. score is recounted server-side from study_answers vs study_questions.correct_answer; started_at/finished_at are server clock, never client-reported, because duration_ms is the tie-break.';
