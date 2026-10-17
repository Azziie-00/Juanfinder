-- Change an existing password and revoke other sessions atomically.
-- Reuses existing users.password_hash and auth_sessions; no data reset.
BEGIN;
-- The application already uses 'library' for Librarians; older schemas omitted it.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'adviser', 'admin', 'superadmin', 'library'));
CREATE OR REPLACE FUNCTION public.change_account_password(
    p_session_hash TEXT, p_current_hash TEXT, p_new_hash TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE actor_id BIGINT;
BEGIN
    SELECT user_id INTO actor_id FROM public.auth_sessions WHERE session_hash = p_session_hash;
    IF actor_id IS NULL THEN RETURN FALSE; END IF;
    PERFORM 1 FROM public.users WHERE user_id = actor_id
        AND role IN ('student', 'adviser', 'library') AND is_active
        AND (expires_at IS NULL OR expires_at > clock_timestamp())
        AND NOT password_change_required AND password_hash = p_current_hash FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    PERFORM 1 FROM public.auth_sessions WHERE session_hash = p_session_hash AND user_id = actor_id
        AND expires_at > clock_timestamp() FOR UPDATE;
    IF NOT FOUND THEN RETURN FALSE; END IF;
    IF p_new_hash IS NULL OR p_new_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN
        RAISE EXCEPTION 'A valid password hash is required.';
    END IF;
    UPDATE public.users SET password_hash = p_new_hash WHERE user_id = actor_id;
    DELETE FROM public.auth_sessions WHERE user_id = actor_id AND session_hash <> p_session_hash;
    RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.change_account_password(TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.change_account_password(TEXT,TEXT,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
