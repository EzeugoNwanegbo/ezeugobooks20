-- Apply after the existing cookie migrations, before deploying the new functions.
BEGIN;
-- Preserve grants; flatten the base allowance to the requested ten credits.
CREATE OR REPLACE FUNCTION public.cookie_daily_base() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$ SELECT 10; $fn$;
CREATE OR REPLACE FUNCTION public.cookie_daily_step() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$ SELECT 0; $fn$;
CREATE OR REPLACE FUNCTION public.cookie_daily_ceiling() RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$ SELECT 10; $fn$;
REVOKE ALL ON FUNCTION public.cookie_daily_base() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cookie_daily_step() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cookie_daily_ceiling() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cookie_daily_base() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cookie_daily_step() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cookie_daily_ceiling() TO authenticated;
COMMENT ON FUNCTION public.cookie_daily_base() IS 'Daily base AI allowance: 10 credits. Admin grants still stack on top.';
COMMENT ON FUNCTION public.cookie_daily_step() IS 'Earned allowance increases are disabled.';
COMMENT ON FUNCTION public.cookie_daily_ceiling() IS 'Earned allowance ceiling: 10 credits, before admin grants.';
CREATE TABLE IF NOT EXISTS public.ai_provider_daily_usage (
  usage_day date PRIMARY KEY,
  calls integer NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  input_chars bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.ai_provider_daily_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_provider_daily_usage FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.reserve_ai_provider_budget(
  p_output_tokens integer, p_input_chars integer,
  p_call_limit integer, p_output_limit integer, p_input_limit integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_day date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_output_tokens IS NULL OR p_input_chars IS NULL OR p_call_limit IS NULL
    OR p_output_limit IS NULL OR p_input_limit IS NULL OR p_output_tokens < 0
    OR p_input_chars < 0 OR p_call_limit < 1 OR p_output_limit < 1 OR p_input_limit < 1 THEN
    RETURN false;
  END IF;
  INSERT INTO public.ai_provider_daily_usage(usage_day) VALUES(v_day) ON CONFLICT DO NOTHING;
  UPDATE public.ai_provider_daily_usage
    SET calls = calls + 1, output_tokens = output_tokens + p_output_tokens,
        input_chars = input_chars + p_input_chars
    WHERE usage_day = v_day AND calls < p_call_limit
      AND output_tokens + p_output_tokens <= p_output_limit
      AND input_chars + p_input_chars <= p_input_limit;
  RETURN FOUND;
END;
$fn$;
REVOKE ALL ON FUNCTION public.reserve_ai_provider_budget(integer,integer,integer,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_provider_budget(integer,integer,integer,integer,integer) TO service_role;

-- A per-user transaction lock prevents simultaneous requests overspending.
CREATE OR REPLACE FUNCTION public.spend_cookies_for(
  p_user   UUID,
  p_action TEXT,
  p_cost   INTEGER
)
RETURNS TABLE (ok BOOLEAN, spend_id BIGINT, allowance INTEGER, spent INTEGER, remaining INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_allowance INTEGER;
  v_spent     INTEGER;
  v_cost      INTEGER := greatest(coalesce(p_cost, 0), 0);
  v_id        BIGINT;
BEGIN
  IF p_user IS NULL THEN
    RETURN QUERY SELECT false, NULL::BIGINT, 0, 0, 0;
    RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  v_allowance := public.cookie_allowance(p_user);

  SELECT coalesce(sum(s.cost), 0)::INTEGER INTO v_spent
  FROM public.cookie_spends s
  WHERE s.user_id = p_user
    AND s.spent_on = (now() AT TIME ZONE 'utc')::DATE;

  v_spent := greatest(v_spent, 0);

  -- A free action still answers ok, so a caller can price something at 0
  -- without special-casing it.
  IF v_cost = 0 THEN
    RETURN QUERY
      SELECT true, NULL::BIGINT, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
    RETURN;
  END IF;

  IF v_spent + v_cost > v_allowance THEN
    RETURN QUERY
      SELECT false, NULL::BIGINT, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
    RETURN;
  END IF;

  INSERT INTO public.cookie_spends (user_id, action, cost)
  VALUES (p_user, coalesce(nullif(btrim(p_action), ''), 'unknown'), v_cost)
  RETURNING id INTO v_id;

  v_spent := v_spent + v_cost;

  RETURN QUERY
    SELECT true, v_id, v_allowance, v_spent, greatest(v_allowance - v_spent, 0);
END;
$fn$;

-- Browser callers must not refund successful generations themselves.
REVOKE ALL ON FUNCTION public.refund_cookie_spend(bigint) FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS public.ai_credit_refunds (
  spend_id bigint PRIMARY KEY REFERENCES public.cookie_spends(id)
);
ALTER TABLE public.ai_credit_refunds ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_credit_refunds FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.refund_ai_credit_spend_for(p_user uuid, p_spend_id bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row public.cookie_spends;
BEGIN
  IF p_user IS NULL THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  SELECT * INTO v_row FROM public.cookie_spends WHERE id = p_spend_id AND user_id = p_user AND cost > 0;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.ai_credit_refunds(spend_id) VALUES(p_spend_id) ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO public.cookie_spends(user_id, action, cost, spent_on)
    VALUES(p_user, 'refund:' || v_row.action, -v_row.cost, v_row.spent_on);
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.refund_ai_credit_spend_for(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_credit_spend_for(uuid,bigint) TO service_role;
COMMIT;
