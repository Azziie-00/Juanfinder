-- Requires existing migrations 001, 002, 005 and 006. No accounts or records are deleted.
BEGIN;

ALTER TABLE public.groups
    ADD COLUMN IF NOT EXISTS adviser_id BIGINT REFERENCES public.users(user_id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS adviser_assigned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS groups_adviser_id_idx ON public.groups(adviser_id) WHERE adviser_id IS NOT NULL;

-- Refuse ambiguous legacy data rather than silently reassigning students or losing records.
DO $$
BEGIN
    IF EXISTS (
        SELECT g.group_id FROM public.groups g
        JOIN public.users u ON u.user_id = g.owner_id OR u.user_id IN
            (SELECT gm.user_id FROM public.group_members gm WHERE gm.group_id = g.group_id)
        LEFT JOIN public.group_adviser_applications a ON a.group_id = g.group_id AND a.status = 'Accepted'
        GROUP BY g.group_id
        HAVING count(DISTINCT u.adviser_id) > 1
            OR count(DISTINCT a.adviser_id) > 1
            OR (min(a.adviser_id) IS NOT NULL AND min(u.adviser_id) IS NOT NULL
                AND min(a.adviser_id) <> min(u.adviser_id))
            OR (min(g.adviser_id) IS NOT NULL AND
                (min(g.adviser_id) IS DISTINCT FROM coalesce(min(a.adviser_id), min(u.adviser_id), min(g.adviser_id))))
    ) THEN
        RAISE EXCEPTION 'Conflicting legacy adviser assignments. Review groups and student adviser_id values before retrying 007.';
    END IF;
END;
$$;

-- Accepted history is authoritative; retain unambiguous existing student assignments too.
WITH legacy AS (
    SELECT g.group_id, coalesce(min(a.adviser_id), min(u.adviser_id)) AS adviser_id
    FROM public.groups g
    LEFT JOIN public.group_adviser_applications a ON a.group_id = g.group_id AND a.status = 'Accepted'
    LEFT JOIN public.users u ON u.user_id = g.owner_id OR u.user_id IN
        (SELECT gm.user_id FROM public.group_members gm WHERE gm.group_id = g.group_id)
    GROUP BY g.group_id
)
UPDATE public.groups g SET adviser_id = l.adviser_id, adviser_assigned_at = coalesce(g.adviser_assigned_at, now())
FROM legacy l WHERE g.group_id = l.group_id AND g.adviser_id IS NULL AND l.adviser_id IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT u.user_id FROM public.users u JOIN public.groups g ON
            u.user_id = g.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = g.group_id)
        WHERE g.adviser_id IS NOT NULL GROUP BY u.user_id HAVING count(DISTINCT g.adviser_id) > 1
    ) THEN
        RAISE EXCEPTION 'A legacy student belongs to groups with conflicting advisers. Review membership before retrying 007.';
    END IF;
END;
$$;

-- An owner missing from group_members is still part of the finalized group.
UPDATE public.users u SET adviser_id = g.adviser_id
FROM public.groups g WHERE g.adviser_id IS NOT NULL AND
    (u.user_id = g.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = g.group_id));

CREATE OR REPLACE VIEW public.adviser_slot_availability AS
SELECT u.user_id, u.user_code, u.username, u.name, u.bio, u.gender, u.requirements,
       u.course, u.expires_at, u.is_active, u.adviser_capacity,
       count(g.group_id)::integer AS assigned_groups,
       greatest(0, u.adviser_capacity - count(g.group_id)::integer) AS remaining_slots
FROM public.users u LEFT JOIN public.groups g ON g.adviser_id = u.user_id
WHERE u.role = 'adviser' GROUP BY u.user_id;
REVOKE ALL ON public.adviser_slot_availability FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.adviser_slot_availability TO service_role;

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
    IF (SELECT count(*) FROM public.groups WHERE adviser_id = p_adviser_id) >= target_adviser.adviser_capacity THEN
        RAISE EXCEPTION 'The selected adviser is unavailable: no remaining slots.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.users u WHERE
        (u.user_id = target_group.owner_id OR u.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = p_group_id))
        AND (u.role <> 'student' OR lower(trim(u.course)) IS DISTINCT FROM lower(trim(target_group.course)))) THEN
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
        AND (u.role <> 'student' OR lower(trim(u.course)) IS DISTINCT FROM lower(trim(target_group.course)))) THEN
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

-- Keep optional document metadata and submission in one transaction. Storage upload precedes this RPC.
CREATE OR REPLACE FUNCTION public.submit_group_adviser_application_with_document(
    p_group_id BIGINT, p_applicant_id BIGINT, p_adviser_id BIGINT, p_document JSONB
) RETURNS BIGINT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE new_id BIGINT;
BEGIN
    new_id := public.submit_group_adviser_application(p_group_id, p_applicant_id, p_adviser_id);
    INSERT INTO public.group_adviser_application_documents
        (application_id, group_id, adviser_id, uploaded_by, file_name, storage_path, file_type, file_size)
    VALUES (new_id, p_group_id, p_adviser_id, p_applicant_id, p_document->>'file_name',
        p_document->>'storage_path', p_document->>'file_type', (p_document->>'file_size')::bigint);
    RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_group_adviser_assignment()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF OLD.adviser_id IS NOT NULL AND (NEW.adviser_id IS DISTINCT FROM OLD.adviser_id
        OR (OLD.finalized_at IS NOT NULL AND NEW.finalized_at IS DISTINCT FROM OLD.finalized_at)
        OR NEW.owner_id IS DISTINCT FROM OLD.owner_id) THEN
        RAISE EXCEPTION 'An assigned group adviser, leader and finalization are permanent.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_group_adviser_assignment ON public.groups;
CREATE TRIGGER guard_group_adviser_assignment BEFORE UPDATE ON public.groups
    FOR EACH ROW EXECUTE FUNCTION public.guard_group_adviser_assignment();

-- Admin membership additions to accepted groups inherit the group's adviser, without taking another slot.
CREATE OR REPLACE FUNCTION public.sync_assigned_group_member()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE assigned_adviser BIGINT;
BEGIN
    SELECT adviser_id INTO assigned_adviser FROM public.groups WHERE group_id = NEW.group_id FOR UPDATE;
    IF assigned_adviser IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM public.users WHERE user_id = NEW.user_id AND adviser_id IS NOT NULL AND adviser_id <> assigned_adviser) THEN
            RAISE EXCEPTION 'A group member is already assigned to another adviser.';
        END IF;
        UPDATE public.users SET adviser_id = assigned_adviser WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_assigned_group_member ON public.group_members;
CREATE TRIGGER sync_assigned_group_member BEFORE INSERT OR UPDATE ON public.group_members
    FOR EACH ROW EXECUTE FUNCTION public.sync_assigned_group_member();

CREATE OR REPLACE FUNCTION public.guard_student_group_adviser()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.groups g WHERE g.adviser_id IS NOT NULL
        AND (g.owner_id = NEW.user_id OR EXISTS (SELECT 1 FROM public.group_members gm WHERE gm.group_id = g.group_id AND gm.user_id = NEW.user_id))
        AND g.adviser_id IS DISTINCT FROM NEW.adviser_id) THEN
        RAISE EXCEPTION 'A group member is already assigned to the permanent group adviser.';
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_student_group_adviser ON public.users;
CREATE TRIGGER guard_student_group_adviser BEFORE UPDATE OF adviser_id ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.guard_student_group_adviser();

REVOKE EXECUTE ON FUNCTION public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN),
    public.submit_group_adviser_application_with_document(BIGINT, BIGINT, BIGINT, JSONB),
    public.guard_group_adviser_assignment(), public.sync_assigned_group_member(), public.guard_student_group_adviser() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN),
    public.submit_group_adviser_application_with_document(BIGINT, BIGINT, BIGINT, JSONB),
    public.guard_group_adviser_assignment(), public.sync_assigned_group_member(), public.guard_student_group_adviser() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
