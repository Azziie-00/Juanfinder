-- Apply after 007. Replaces application rules only; existing accepted assignments are untouched.
BEGIN;

CREATE OR REPLACE FUNCTION public.adviser_courses_match(p_group_course TEXT, p_adviser_course TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path = public AS $$
    SELECT coalesce(g NOT IN ('', 'unspecified') AND a NOT IN ('', 'unspecified') AND g = a, false)
    FROM (SELECT lower(regexp_replace(p_group_course, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS g,
                 lower(regexp_replace(p_adviser_course, '^[[:space:]]+|[[:space:]]+$', '', 'g')) AS a) normalized;
$$;

CREATE OR REPLACE FUNCTION public.submit_group_adviser_application(
    p_group_id BIGINT, p_applicant_id BIGINT, p_adviser_id BIGINT
) RETURNS BIGINT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    target_group public.groups;
    target_adviser public.users;
    new_application_id BIGINT;
BEGIN
    SELECT * INTO target_group FROM public.groups WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found.'; END IF;
    IF p_applicant_id IS NULL OR target_group.owner_id IS DISTINCT FROM p_applicant_id THEN
        RAISE EXCEPTION 'Only the group leader can apply for an adviser.';
    END IF;
    IF target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must be finalized before applying for an adviser.'; END IF;
    IF target_group.adviser_id IS NOT NULL THEN RAISE EXCEPTION 'This group is already assigned to an adviser.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE user_id = p_applicant_id AND role = 'student'
        AND is_active AND (expires_at IS NULL OR expires_at > now())) THEN
        RAISE EXCEPTION 'Only active students can apply for an adviser.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.group_adviser_applications WHERE group_id = p_group_id AND status IN ('Pending', 'Accepted')) THEN
        RAISE EXCEPTION 'This group already has an active adviser application.';
    END IF;
    SELECT * INTO target_adviser FROM public.users WHERE user_id = p_adviser_id
        AND role = 'adviser' AND is_active AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;
    IF NOT public.adviser_courses_match(target_group.course, target_adviser.course) THEN
        RAISE EXCEPTION 'The adviser course must match the group course. Blank or Unspecified courses cannot receive applications.';
    END IF;
    IF (SELECT count(*) FROM public.groups WHERE adviser_id = p_adviser_id) >= target_adviser.adviser_capacity THEN
        RAISE EXCEPTION 'The selected adviser is unavailable: no remaining slots.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE
        (u.user_id = target_group.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = p_group_id))
        AND (u.role <> 'student' OR NOT public.adviser_courses_match(target_group.course, u.course))) THEN
        RAISE EXCEPTION 'All group members must be students in the group course.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE
        (u.user_id = target_group.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = p_group_id))
        AND u.adviser_id IS NOT NULL AND u.adviser_id <> p_adviser_id) THEN
        RAISE EXCEPTION 'A group member is already assigned to another adviser.';
    END IF;
    INSERT INTO public.group_adviser_applications (group_id, adviser_id, applicant_id, status)
        VALUES (p_group_id, p_adviser_id, p_applicant_id, 'Pending') RETURNING application_id INTO new_application_id;
    RETURN new_application_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_group_adviser_application(
    p_application_id BIGINT, p_adviser_id BIGINT, p_accept BOOLEAN
) RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    target_application public.group_adviser_applications;
    target_group public.groups;
    target_adviser public.users;
BEGIN
    IF p_accept IS NULL THEN RAISE EXCEPTION 'A response is required.'; END IF;
    -- Lock the group before its application, matching submission's lock order.
    SELECT * INTO target_application FROM public.group_adviser_applications WHERE application_id = p_application_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    SELECT * INTO target_group FROM public.groups WHERE group_id = target_application.group_id FOR UPDATE;
    SELECT * INTO target_application FROM public.group_adviser_applications WHERE application_id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    IF p_adviser_id IS NULL OR target_application.adviser_id IS DISTINCT FROM p_adviser_id THEN
        RAISE EXCEPTION 'Only the selected adviser can respond to this application.';
    END IF;
    IF target_application.status <> 'Pending' THEN RAISE EXCEPTION 'This adviser application has already been processed.'; END IF;
    SELECT * INTO target_adviser FROM public.users WHERE user_id = p_adviser_id
        AND role = 'adviser' AND is_active AND (expires_at IS NULL OR expires_at > now()) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;
    IF NOT p_accept THEN
        UPDATE public.group_adviser_applications SET status = 'Rejected', responded_at = now() WHERE application_id = p_application_id;
        RETURN 'Rejected';
    END IF;
    IF NOT public.adviser_courses_match(target_group.course, target_adviser.course) THEN
        RAISE EXCEPTION 'The adviser course must match the group course. Blank or Unspecified courses cannot receive applications.';
    END IF;
    IF target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must remain finalized before acceptance.'; END IF;
    IF target_group.adviser_id IS NOT NULL THEN RAISE EXCEPTION 'This group is already assigned to an adviser.'; END IF;
    -- The adviser row serializes competing acceptances and capacity edits.
    IF (SELECT count(*) FROM public.groups WHERE adviser_id = p_adviser_id) >= target_adviser.adviser_capacity THEN
        RAISE EXCEPTION 'The selected adviser is unavailable: no remaining slots.';
    END IF;
    PERFORM u.user_id FROM public.users u WHERE u.user_id = target_group.owner_id OR u.user_id IN
        (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id) ORDER BY u.user_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.users u WHERE
        (u.user_id = target_group.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id))
        AND (u.role <> 'student' OR NOT public.adviser_courses_match(target_group.course, u.course))) THEN
        RAISE EXCEPTION 'All group members must be students in the group course.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE
        (u.user_id = target_group.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id))
        AND u.adviser_id IS NOT NULL AND u.adviser_id <> p_adviser_id) THEN
        RAISE EXCEPTION 'A group member is already assigned to another adviser.';
    END IF;
    UPDATE public.users SET adviser_id = p_adviser_id WHERE user_id = target_group.owner_id OR user_id IN
        (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id);
    UPDATE public.groups SET adviser_id = p_adviser_id, adviser_assigned_at = now() WHERE group_id = target_group.group_id;
    UPDATE public.group_adviser_applications SET status = 'Accepted', responded_at = now() WHERE application_id = p_application_id;
    RETURN 'Accepted';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.adviser_courses_match(TEXT, TEXT),
    public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adviser_courses_match(TEXT, TEXT),
    public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
