-- Read-only report: one JSON result avoids PostgREST's row limit truncating exports.
-- Only the trusted API may supply the authenticated adviser's ID.
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
    SELECT m.group_id, u.user_id, u.user_code, u.name, u.course
    FROM memberships m JOIN public.users u USING (user_id) WHERE u.role = 'student'
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
    'AdviserName', u.name,
    'Summary', jsonb_build_object('Groups', (SELECT count(*) FROM assigned),
        'StudentMembers', (SELECT count(DISTINCT user_id) FROM students),
        'Capacity', u.adviser_capacity,
        'AvailableSlots', greatest(0, u.adviser_capacity - (SELECT count(*) FROM assigned))),
    'Groups', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'GroupID', group_id, 'GroupName', group_name, 'Course', course,
        'MemberCount', member_count, 'Members', members) ORDER BY group_name, group_id) FROM reports), '[]'::jsonb)
)
FROM public.users u WHERE u.user_id = p_adviser_id AND u.role = 'adviser';
$$;

REVOKE EXECUTE ON FUNCTION public.get_adviser_dashboard_report(BIGINT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_adviser_dashboard_report(BIGINT,TEXT) TO service_role;
