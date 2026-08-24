-- ═══════════════════════════════════════════════════════════════════════════
-- ADMIN STUDENT LOOKUP: FIND ANYONE, NOT JUST THE DISCOVERABLE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR. Prerequisites: public.is_admin()
-- (20260719120000_add_library.sql) and public.is_guest_account()
-- (20260809120000_social_usernames_friends_async_challenges.sql). Section 0
-- checks rather than trusts.
--
-- Nothing to do afterwards. The admin page detects this function and falls back
-- to find_students() when it is missing, so applying it simply widens what the
-- search box can reach on the next page load.
--
--
-- WHY THIS EXISTS
-- ---------------
-- The cookie grant screen (/app/admin) has to find a student before it can give
-- them more cookies. It was built on find_students(), the friend-search RPC,
-- because that was the only lookup that existed. That function ends with:
--
--     AND (p.discoverable_by = 'anyone' OR p.id = auth.uid())
--
-- which is exactly right for friend search and exactly wrong here. A student who
-- has turned discoverability off is invisible to it - so when that student
-- messages the owner on WhatsApp asking for more cookies, the owner cannot find
-- them to grant any. The empty-state dialog makes a promise the admin screen
-- could not keep for a subset of students, and it is the privacy-conscious
-- subset, which is the worst group to quietly penalise.
--
--
-- WHY THIS DOES NOT REOPEN THE ENUMERATION RISK
-- ---------------------------------------------
-- 20260815120000 argued at length that a prefix endpoint lets any account page
-- out a roster of identifiable medical and law students, and bounded
-- find_students() tightly because of it: three characters minimum, ten results,
-- no offset, handles only, opted-in students only.
--
-- Every one of those bounds exists because find_students() is reachable by ANY
-- authenticated account. This function is not. It RAISES for anybody who is not
-- an admin - not "returns no rows", which would leave a non-admin unable to tell
-- refusal from absence and would invite probing. The guarded population is a
-- handful of accounts the owner sets by hand in user_profiles.is_admin, so the
-- threat model that shaped find_students() simply does not apply.
--
-- What is kept anyway, because they cost nothing:
--   * a result cap (50), so no call returns the whole table;
--   * guest accounts excluded - an anonymous session is discarded on sign-out,
--     so a cookie grant against one is a promise the app cannot keep;
--   * no offset parameter, so there is still no way to page through everybody.
--
-- What is deliberately relaxed for admins: matching anywhere in the handle
-- rather than only at the start, matching the DISPLAY NAME as well, a two
-- character minimum instead of three, and no discoverability filter. The owner
-- is answering a message from someone who has just told them who they are; the
-- search only has to confirm it.
--
--
-- ADDITIVE AND SAFE. One new function. Nothing altered, dropped or backfilled.


-- ── Section 0: guard ────────────────────────────────────────────────────────
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_admin'
  ) THEN
    RAISE EXCEPTION
      'public.is_admin() is missing. Apply 20260719120000_add_library.sql first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_guest_account'
  ) THEN
    RAISE EXCEPTION
      'public.is_guest_account() is missing. Apply 20260809120000_social_usernames_friends_async_challenges.sql first.';
  END IF;
END
$guard$;


CREATE OR REPLACE FUNCTION public.admin_find_students(
  p_query TEXT,
  p_limit INT DEFAULT 10
)
RETURNS TABLE (
  user_id      UUID,
  username     TEXT,
  display_name TEXT,
  points       INTEGER,
  -- Surfaced rather than filtered on. An admin looking at a student who cannot
  -- be found by their classmates should be able to SEE that, since it explains
  -- why the student is here asking for help by message in the first place.
  discoverable BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- LIKE has three metacharacters and an admin may type any of them, since this
  -- matches display names as well as handles. Escaping order matters: the
  -- backslash must be doubled FIRST, or the escapes added afterwards would
  -- themselves be re-escaped.
  v_needle TEXT := lower(btrim(coalesce(p_query, '')));
  v_like   TEXT;
  v_limit  INT := greatest(1, least(coalesce(p_limit, 10), 50));
BEGIN
  IF NOT public.is_admin() THEN
    -- Loud, not silent. An empty result would leave a non-admin unable to tell
    -- "you may not ask" from "nobody matched", which is an invitation to probe.
    RAISE EXCEPTION 'admin_find_students is restricted to administrators'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_needle) < 2 THEN
    RETURN;                       -- too short to mean anything. No rows, no error.
  END IF;

  v_like := replace(v_needle, '\', '\\');
  v_like := replace(v_like, '%', '\%');
  v_like := replace(v_like, '_', '\_');

  RETURN QUERY
  SELECT
    p.id,
    p.username,
    coalesce(nullif(btrim(p.name), ''), 'Student'),
    coalesce(p.points, 0),
    (p.discoverable_by = 'anyone')
  FROM public.user_profiles p
  WHERE NOT public.is_guest_account(p.id)
    AND (
      lower(coalesce(p.username, '')) LIKE '%' || v_like || '%' ESCAPE '\'
      OR lower(coalesce(p.name, ''))  LIKE '%' || v_like || '%' ESCAPE '\'
    )
  -- Exact handle first (it is what the owner was most likely given over
  -- WhatsApp), then handles that START with the query, then shortest handle,
  -- then alphabetical so repeated identical searches are stable.
  ORDER BY
    (lower(coalesce(p.username, '')) = v_needle) DESC,
    (lower(coalesce(p.username, '')) LIKE v_like || '%' ESCAPE '\') DESC,
    length(coalesce(p.username, '')),
    lower(coalesce(p.username, '')),
    p.id
  LIMIT v_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_find_students(TEXT, INT) FROM PUBLIC, anon;
-- Granted to `authenticated` because that is the only role a signed-in admin
-- has; the is_admin() check INSIDE the function is what actually restricts it.
GRANT EXECUTE ON FUNCTION public.admin_find_students(TEXT, INT) TO authenticated;

COMMENT ON FUNCTION public.admin_find_students(TEXT, INT) IS
  'Admin-only student lookup for the cookie grant screen. Unlike find_students() it ignores discoverable_by, matches display names, and matches anywhere in the handle - safe because it RAISES for non-admins rather than being reachable by every authenticated account. Guests excluded; 50 results maximum; no offset.';
