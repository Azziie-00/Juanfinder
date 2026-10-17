ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS adviser_capacity INTEGER NOT NULL DEFAULT 10;

ALTER TABLE public.users
    DROP CONSTRAINT IF EXISTS users_adviser_capacity_nonnegative;

ALTER TABLE public.users
    ADD CONSTRAINT users_adviser_capacity_nonnegative CHECK (adviser_capacity >= 0);

CREATE OR REPLACE FUNCTION public.submit_group_adviser_application(
    p_group_id BIGINT,
    p_applicant_id BIGINT,
    p_adviser_id BIGINT
) RETURNS BIGINT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    target_group public.groups;
    target_adviser public.users;
    application_id BIGINT;
    assigned_group_count INTEGER;
BEGIN
    SELECT * INTO target_group FROM public.groups WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found.'; END IF;
    IF target_group.owner_id IS DISTINCT FROM p_applicant_id THEN RAISE EXCEPTION 'Only the group leader can apply for an adviser.'; END IF;
    IF target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must be finalized before applying for an adviser.'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users
        WHERE user_id = p_applicant_id AND role = 'student' AND is_active
          AND lower(trim(course)) = lower(trim(target_group.course))
    ) THEN RAISE EXCEPTION 'The group leader course does not match the group course.'; END IF;

    SELECT * INTO target_adviser FROM public.users
    WHERE user_id = p_adviser_id AND role = 'adviser' AND is_active
      AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;

    SELECT COUNT(DISTINCT gm.group_id) INTO assigned_group_count
    FROM public.group_members gm
    JOIN public.users u ON u.user_id = gm.user_id
    WHERE u.adviser_id = p_adviser_id;
    IF assigned_group_count >= target_adviser.adviser_capacity THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;

    IF EXISTS (
        SELECT 1 FROM public.group_members gm
        JOIN public.users u ON u.user_id = gm.user_id
        WHERE gm.group_id = p_group_id
          AND lower(trim(u.course)) <> lower(trim(target_group.course))
    ) THEN RAISE EXCEPTION 'All group members must be in the group course.'; END IF;

    INSERT INTO public.group_adviser_applications (group_id, adviser_id, applicant_id)
    VALUES (p_group_id, p_adviser_id, p_applicant_id)
    RETURNING group_adviser_applications.application_id INTO application_id;
    RETURN application_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'This group already has an active adviser application.';
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_group_adviser_application(
    p_application_id BIGINT,
    p_adviser_id BIGINT,
    p_accept BOOLEAN
) RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    target_application public.group_adviser_applications;
    target_group public.groups;
    target_adviser public.users;
    assigned_group_count INTEGER;
BEGIN
    SELECT * INTO target_application FROM public.group_adviser_applications
    WHERE application_id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    IF target_application.adviser_id <> p_adviser_id THEN RAISE EXCEPTION 'Only the selected adviser can respond to this application.'; END IF;
    IF target_application.status <> 'Pending' THEN RAISE EXCEPTION 'This adviser application has already been processed.'; END IF;

    SELECT * INTO target_group FROM public.groups WHERE group_id = target_application.group_id FOR UPDATE;
    IF NOT FOUND OR target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must remain finalized while its adviser application is processed.'; END IF;
    SELECT * INTO target_adviser FROM public.users
    WHERE user_id = p_adviser_id AND role = 'adviser' AND is_active
      AND (expires_at IS NULL OR expires_at > NOW()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;

    IF p_accept THEN
        IF EXISTS (
            SELECT 1 FROM public.group_members gm
            JOIN public.users u ON u.user_id = gm.user_id
            WHERE gm.group_id = target_group.group_id
              AND lower(trim(u.course)) <> lower(trim(target_group.course))
        ) THEN RAISE EXCEPTION 'All group members must be in the group course.'; END IF;
        IF EXISTS (
            SELECT 1 FROM public.group_members gm
            JOIN public.users u ON u.user_id = gm.user_id
            WHERE gm.group_id = target_group.group_id
              AND u.adviser_id IS NOT NULL AND u.adviser_id <> p_adviser_id
        ) THEN RAISE EXCEPTION 'A group member is already assigned to another adviser.'; END IF;
        SELECT COUNT(DISTINCT gm.group_id) INTO assigned_group_count
        FROM public.group_members gm
        JOIN public.users u ON u.user_id = gm.user_id
        WHERE u.adviser_id = p_adviser_id;
        IF assigned_group_count >= target_adviser.adviser_capacity THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;

        UPDATE public.users SET adviser_id = p_adviser_id
        WHERE user_id IN (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id);
        UPDATE public.group_adviser_applications
        SET status = 'Accepted', responded_at = NOW()
        WHERE application_id = p_application_id;
        RETURN 'Accepted';
    END IF;

    UPDATE public.group_adviser_applications
    SET status = 'Rejected', responded_at = NOW()
    WHERE application_id = p_application_id;
    RETURN 'Rejected';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN) TO service_role;
