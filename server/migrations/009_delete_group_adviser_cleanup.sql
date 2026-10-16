-- Deleting a group releases its former members to apply with a new group.
-- Existing groups, accounts and assignments are unchanged when this migration runs.
BEGIN;
CREATE OR REPLACE FUNCTION public.admin_delete_group(p_group_id BIGINT, p_admin_id BIGINT)
RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    target_group public.groups;
    member_ids BIGINT[];
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_admin_id
        AND role IN ('admin', 'superadmin') AND is_active
        AND (expires_at IS NULL OR expires_at > now())) THEN
        RAISE EXCEPTION 'Admin access is required.';
    END IF;
    SELECT * INTO target_group FROM public.groups WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found.'; END IF;
    SELECT array_agg(DISTINCT user_id) INTO member_ids FROM (
        SELECT user_id FROM public.group_members WHERE group_id = p_group_id
        UNION SELECT target_group.owner_id WHERE target_group.owner_id IS NOT NULL
    ) members;
    -- Serialize with acceptance and other assignment changes.
    IF target_group.adviser_id IS NOT NULL THEN
        PERFORM user_id FROM public.users WHERE user_id = target_group.adviser_id FOR UPDATE;
    END IF;
    PERFORM user_id FROM public.users WHERE user_id = ANY(member_ids) ORDER BY user_id FOR UPDATE;
    DELETE FROM public.groups WHERE group_id = p_group_id;
    -- Delete first so the permanent-assignment guard no longer sees the removed group.
    -- Include legacy student assignments even if the deleted group had no adviser link.
    -- Keep any assignment still required by another surviving assigned group.
        UPDATE public.users u SET adviser_id = NULL
        WHERE u.user_id = ANY(member_ids) AND u.role = 'student' AND u.adviser_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.adviser_id IS NOT NULL
              AND (g.owner_id = u.user_id OR EXISTS (
                  SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.group_id AND gm.user_id = u.user_id)));
END;
$$;
REVOKE EXECUTE ON FUNCTION public.admin_delete_group(BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_group(BIGINT, BIGINT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
