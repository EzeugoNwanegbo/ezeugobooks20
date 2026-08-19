-- ═══════════════════════════════════════════════════════════════════════════
-- ONCE IN A LIFETIME: first-run flags that belong to the ACCOUNT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- APPLY BY HAND IN THE SUPABASE SQL EDITOR. Nothing else is needed afterwards:
-- src/lib/seen-once.ts DETECTS this column rather than reading a hand-flipped
-- constant (see [detect-migrations-not-flags]), so the behaviour changes on the
-- next page load. Until it is applied, a missing column answers 42703 /
-- PGRST204, the module latches and degrades to exactly the localStorage-only
-- behaviour that came before it.
--
-- WHY. The guided tour and every per-page intro were gated on localStorage,
-- keyed per user id. That is once per BROWSER, not once per person: clearing
-- the cache, moving from phone to laptop, or opening a private window met the
-- tour and every explanatory paragraph all over again. The owner's rule is once
-- in a lifetime, so the flag has to live where the account lives.
--
-- WHY A text[] AND NOT A BOOLEAN PER SURFACE. There are three surfaces today
-- (tour, library, friends) and there will be more. A column per surface means a
-- migration every time one is added; an open token list means none. The client
-- ignores tokens it does not recognise, so an older build meeting a newer token
-- simply carries on.
--
-- ADDITIVE AND SAFE. One nullable-free column with a default, no backfill, no
-- data touched. Existing rows get '{}' and behave as first-timers on the server
-- side - which is correct, because their real history is the localStorage cache
-- they already have, and seen-once.ts only ever ADDS flags from the server, it
-- never clears a local one.
--
-- NO NEW RLS. user_profiles is already strictly own-row ("Users view own
-- profile", 20260425233320), so a student reads and writes exactly their own
-- list and nobody else's.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS seen_intros TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.user_profiles.seen_intros IS
  'Tokens for first-run surfaces this account has already been shown (tour, library, friends, ...). Written by src/lib/seen-once.ts. An open token list on purpose: adding a new first-run surface must not need a migration.';
