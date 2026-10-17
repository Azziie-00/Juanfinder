-- Preserve history independently of auth_sessions, which logout/expiry may delete.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;
ALTER TABLE public.auth_sessions
    ADD COLUMN IF NOT EXISTS previous_activity_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.initialize_website_activity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE previous_time TIMESTAMPTZ; activity_time TIMESTAMPTZ;
BEGIN
    -- Serialize logins and activity for this account. Never trust client timestamps.
    SELECT last_activity_at INTO previous_time FROM public.users WHERE user_id = NEW.user_id FOR UPDATE;
    activity_time := clock_timestamp();
    NEW.previous_activity_at := previous_time;
    NEW.last_activity_at := activity_time;
    UPDATE public.users SET last_activity_at = activity_time WHERE user_id = NEW.user_id;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS auth_session_website_activity ON public.auth_sessions;
CREATE TRIGGER auth_session_website_activity BEFORE INSERT ON public.auth_sessions
FOR EACH ROW EXECUTE FUNCTION public.initialize_website_activity();

CREATE OR REPLACE FUNCTION public.record_website_activity(p_session_hash TEXT)
RETURNS TIMESTAMPTZ LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE actor_id BIGINT; activity_time TIMESTAMPTZ;
BEGIN
    SELECT user_id INTO actor_id FROM public.auth_sessions WHERE session_hash = p_session_hash;
    IF actor_id IS NULL THEN RETURN NULL; END IF;
    -- Same lock order as session initialization, including concurrent tabs/logins.
    PERFORM 1 FROM public.users WHERE user_id = actor_id AND is_active
        AND (expires_at IS NULL OR expires_at > clock_timestamp()) FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    PERFORM 1 FROM public.auth_sessions WHERE session_hash = p_session_hash AND user_id = actor_id
        AND expires_at > clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RETURN NULL; END IF;
    activity_time := clock_timestamp();
    UPDATE public.auth_sessions SET last_activity_at = activity_time WHERE session_hash = p_session_hash;
    UPDATE public.users SET last_activity_at = activity_time WHERE user_id = actor_id;
    RETURN activity_time;
END;
$$;

-- Custom bearer sessions are validated by the API, not by Supabase Auth.
REVOKE EXECUTE ON FUNCTION public.initialize_website_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_website_activity(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_website_activity(), public.record_website_activity(TEXT) TO service_role;
-- Existing sessions retain NULL history: no activity is invented or backfilled.
NOTIFY pgrst, 'reload schema';
