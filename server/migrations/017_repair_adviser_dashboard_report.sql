-- Restore the dashboard report after the role-profile split.
-- Read-only function replacement; no records are updated or deleted.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_adviser_dashboard_report(p_adviser_id BIGINT, p_search TEXT DEFAULT '')
RETURNS JSONB
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH assigned AS (
    SELECT * FROM public.groups WHERE adviser_id = p_adviser_id
), memberships AS (
    SELECT g.group_id, gm.user_id FROM assigned g JOIN public.group_members gm USING (group_id)
    UNION
    SELECT group_id, owner_id FROM assigned WHERE owner_id IS NOT NULL
), students AS (
    SELECT m.group_id, identity.user_id, identity.user_code, identity.name, student.course
    FROM memberships m
    JOIN public.users identity USING (user_id)
    JOIN public.students student USING (user_id)
    WHERE identity.role = 'student'
), reports AS (
    SELECT g.group_id, g.group_name, g.course,
        (SELECT count(*) FROM students s WHERE s.group_id = g.group_id) AS member_count,
        COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'UserID', s.user_id, 'UserCode', s.user_code, 'Name', s.name, 'Course', s.course,
            'IsLeader', s.user_id = g.owner_id) ORDER BY s.name, s.user_id)
            FROM students s WHERE s.group_id = g.group_id), '[]'::jsonb) AS members
    FROM assigned g
    WHERE trim(COALESCE(p_search, '')) = '' OR EXISTS (
        SELECT 1 FROM students s WHERE s.group_id = g.group_id AND
        (strpos(lower(s.name), lower(trim(p_search))) > 0 OR strpos(lower(s.user_code), lower(trim(p_search))) > 0)
    )
)
SELECT jsonb_build_object(
    'AdviserName', identity.name,
    'Summary', jsonb_build_object('Groups', (SELECT count(*) FROM assigned),
        'StudentMembers', (SELECT count(DISTINCT user_id) FROM students),
        'Capacity', adviser.adviser_capacity,
        'AvailableSlots', greatest(0, adviser.adviser_capacity - (SELECT count(*) FROM assigned))),
    'Groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'GroupID', group_id, 'GroupName', group_name, 'Course', course,
        'MemberCount', member_count, 'Members', members) ORDER BY group_name, group_id) FROM reports), '[]'::jsonb)
)
FROM public.users identity
JOIN public.advisers adviser USING (user_id)
WHERE identity.user_id = p_adviser_id AND identity.role = 'adviser';
$$;
REVOKE EXECUTE ON FUNCTION public.get_adviser_dashboard_report(BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_adviser_dashboard_report(BIGINT,TEXT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
