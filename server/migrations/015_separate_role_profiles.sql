-- Keep shared authentication identities in users; move student and adviser
-- details into role-specific tables without deleting accounts or relationships.
BEGIN;

CREATE TABLE IF NOT EXISTS public.students (
    user_id BIGINT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
    course TEXT NOT NULL DEFAULT 'Unspecified',
    year_level TEXT NOT NULL DEFAULT '',
    specialty TEXT NOT NULL DEFAULT '',
    skills TEXT[] NOT NULL DEFAULT '{}',
    adviser_id BIGINT REFERENCES public.users(user_id) ON DELETE SET NULL,
    birthdate DATE,
    gender TEXT NOT NULL DEFAULT '',
    socials TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS students_adviser_id_idx
    ON public.students(adviser_id) WHERE adviser_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.advisers (
    user_id BIGINT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE,
    course TEXT NOT NULL DEFAULT 'Unspecified',
    bio TEXT NOT NULL DEFAULT '',
    gender TEXT NOT NULL DEFAULT '',
    requirements TEXT NOT NULL DEFAULT '',
    adviser_capacity INTEGER NOT NULL DEFAULT 10 CHECK (adviser_capacity >= 0)
);

CREATE TABLE IF NOT EXISTS public.librarians (
    user_id BIGINT PRIMARY KEY REFERENCES public.users(user_id) ON DELETE CASCADE
);

ALTER TABLE public.advisers ADD COLUMN IF NOT EXISTS specialty TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS skills TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advisers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.librarians ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.students, public.advisers, public.librarians FROM anon, authenticated;
GRANT ALL ON public.students, public.advisers, public.librarians TO service_role;

INSERT INTO public.librarians(user_id)
SELECT user_id FROM public.users WHERE role = 'library'
ON CONFLICT (user_id) DO NOTHING;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'course'
    ) THEN
        EXECUTE 'INSERT INTO public.students (
            user_id, course, year_level, specialty, skills, adviser_id, birthdate, gender, socials, bio
        )
        SELECT user_id, course, year_level, specialty, skills, adviser_id, birthdate, gender, socials, bio
        FROM public.users WHERE role = ''student''
        ON CONFLICT (user_id) DO NOTHING';
        EXECUTE 'INSERT INTO public.advisers (
            user_id, course, bio, gender, requirements, adviser_capacity, specialty, skills
        )
        SELECT user_id, course, bio, gender, requirements, adviser_capacity, specialty, skills
        FROM public.users WHERE role = ''adviser''
        ON CONFLICT (user_id) DO NOTHING';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_role_profile()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
        DELETE FROM public.students WHERE user_id = NEW.user_id;
        DELETE FROM public.advisers WHERE user_id = NEW.user_id;
        DELETE FROM public.librarians WHERE user_id = NEW.user_id;
    END IF;

    IF NEW.role = 'student' THEN
        INSERT INTO public.students(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    ELSIF NEW.role = 'adviser' THEN
        INSERT INTO public.advisers(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    ELSIF NEW.role = 'library' THEN
        INSERT INTO public.librarians(user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_role_profile ON public.users;
CREATE TRIGGER ensure_role_profile
AFTER INSERT OR UPDATE ON public.users
FOR EACH ROW EXECUTE FUNCTION public.ensure_role_profile();

DROP VIEW IF EXISTS public.adviser_slot_availability;

CREATE OR REPLACE VIEW public.adviser_slot_availability AS
SELECT identity.user_id, identity.user_code, identity.username, identity.name,
       adviser.bio, adviser.gender, adviser.requirements, adviser.course,
       identity.expires_at, identity.is_active, adviser.adviser_capacity,
       count(group_record.group_id)::integer AS assigned_groups,
       greatest(0, adviser.adviser_capacity - count(group_record.group_id)::integer) AS remaining_slots
FROM public.advisers adviser
JOIN public.users identity ON identity.user_id = adviser.user_id
LEFT JOIN public.groups group_record ON group_record.adviser_id = adviser.user_id
GROUP BY identity.user_id, adviser.user_id;
REVOKE ALL ON public.adviser_slot_availability FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.adviser_slot_availability TO service_role;

CREATE OR REPLACE FUNCTION public.submit_group_adviser_application(
    p_group_id BIGINT, p_applicant_id BIGINT, p_adviser_id BIGINT
) RETURNS BIGINT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    target_group public.groups;
    target_adviser public.advisers;
    new_application_id BIGINT;
BEGIN
    SELECT * INTO target_group FROM public.groups WHERE group_id = p_group_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Group not found.'; END IF;
    IF p_applicant_id IS NULL OR target_group.owner_id IS DISTINCT FROM p_applicant_id THEN
        RAISE EXCEPTION 'Only the group leader can apply for an adviser.';
    END IF;
    IF target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must be finalized before applying for an adviser.'; END IF;
    IF target_group.adviser_id IS NOT NULL THEN RAISE EXCEPTION 'This group is already assigned to an adviser.'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.users identity JOIN public.students student USING (user_id)
        WHERE identity.user_id = p_applicant_id AND identity.role = 'student'
          AND identity.is_active AND (identity.expires_at IS NULL OR identity.expires_at > now())
    ) THEN RAISE EXCEPTION 'Only active students can apply for an adviser.'; END IF;

    PERFORM public.expire_group_adviser_applications(p_group_id);
    IF EXISTS (SELECT 1 FROM public.group_adviser_applications WHERE group_id = p_group_id AND status IN ('Pending', 'Accepted')) THEN
        RAISE EXCEPTION 'This group already has an active adviser application.';
    END IF;

    SELECT adviser.* INTO target_adviser
    FROM public.advisers adviser
    JOIN public.users identity USING (user_id)
    WHERE adviser.user_id = p_adviser_id AND identity.role = 'adviser'
      AND identity.is_active AND (identity.expires_at IS NULL OR identity.expires_at > now())
    FOR UPDATE OF adviser, identity;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;
    IF NOT public.adviser_courses_match(target_group.course, target_adviser.course) THEN
        RAISE EXCEPTION 'The adviser course must match the group course. Blank or Unspecified courses cannot receive applications.';
    END IF;
    IF (SELECT count(*) FROM public.groups WHERE adviser_id = p_adviser_id) >= target_adviser.adviser_capacity THEN
        RAISE EXCEPTION 'The selected adviser is unavailable: no remaining slots.';
    END IF;
    IF EXISTS (
        SELECT 1 FROM (
            SELECT target_group.owner_id AS user_id
            UNION SELECT user_id FROM public.group_members WHERE group_id = p_group_id
        ) members
        LEFT JOIN public.users identity USING (user_id)
        LEFT JOIN public.students student USING (user_id)
        WHERE identity.role IS DISTINCT FROM 'student'
           OR NOT public.adviser_courses_match(target_group.course, student.course)
    ) THEN RAISE EXCEPTION 'All group members must be students in the group course.'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.students student
        WHERE student.user_id IN (
            SELECT target_group.owner_id
            UNION SELECT user_id FROM public.group_members WHERE group_id = p_group_id
        )
        AND student.adviser_id IS NOT NULL AND student.adviser_id <> p_adviser_id
    ) THEN RAISE EXCEPTION 'A group member is already assigned to another adviser.'; END IF;

    INSERT INTO public.group_adviser_applications (group_id, adviser_id, applicant_id, status)
    VALUES (p_group_id, p_adviser_id, p_applicant_id, 'Pending')
    RETURNING application_id INTO new_application_id;
    RETURN new_application_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.respond_to_group_adviser_application(
    p_application_id BIGINT, p_adviser_id BIGINT, p_accept BOOLEAN
) RETURNS TEXT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    target_application public.group_adviser_applications;
    processed_status TEXT;
    target_group public.groups;
    target_adviser public.advisers;
BEGIN
    IF p_accept IS NULL THEN RAISE EXCEPTION 'A response is required.'; END IF;
    SELECT * INTO target_application FROM public.group_adviser_applications WHERE application_id = p_application_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    SELECT * INTO target_group FROM public.groups WHERE group_id = target_application.group_id FOR UPDATE;
    SELECT * INTO target_application FROM public.group_adviser_applications WHERE application_id = p_application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    IF p_adviser_id IS NULL OR target_application.adviser_id IS DISTINCT FROM p_adviser_id THEN
        RAISE EXCEPTION 'Only the selected adviser can respond to this application.';
    END IF;
    IF target_application.status = 'Expired' THEN RETURN 'Expired'; END IF;
    IF target_application.status <> 'Pending' THEN RAISE EXCEPTION 'This adviser application has already been processed.'; END IF;

    SELECT adviser.* INTO target_adviser
    FROM public.advisers adviser
    JOIN public.users identity USING (user_id)
    WHERE adviser.user_id = p_adviser_id AND identity.role = 'adviser'
      AND identity.is_active AND (identity.expires_at IS NULL OR identity.expires_at > now())
    FOR UPDATE OF adviser, identity;
    IF NOT FOUND THEN RAISE EXCEPTION 'The selected adviser is unavailable.'; END IF;
    IF target_application.expires_at <= clock_timestamp() THEN
        UPDATE public.group_adviser_applications
        SET status = 'Expired', responded_at = expires_at
        WHERE application_id = p_application_id;
        RETURN 'Expired';
    END IF;
    IF NOT p_accept THEN
        UPDATE public.group_adviser_applications
        SET status = 'Rejected', responded_at = clock_timestamp()
        WHERE application_id = p_application_id
        RETURNING status INTO processed_status;
        RETURN processed_status;
    END IF;
    IF NOT public.adviser_courses_match(target_group.course, target_adviser.course) THEN
        RAISE EXCEPTION 'The adviser course must match the group course. Blank or Unspecified courses cannot receive applications.';
    END IF;
    IF target_group.finalized_at IS NULL THEN RAISE EXCEPTION 'The group must remain finalized before acceptance.'; END IF;
    IF target_group.adviser_id IS NOT NULL THEN RAISE EXCEPTION 'This group is already assigned to an adviser.'; END IF;
    IF (SELECT count(*) FROM public.groups WHERE adviser_id = p_adviser_id) >= target_adviser.adviser_capacity THEN
        RAISE EXCEPTION 'The selected adviser is unavailable: no remaining slots.';
    END IF;
    PERFORM identity.user_id
    FROM public.users identity
    WHERE identity.user_id = target_group.owner_id
       OR identity.user_id IN (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id)
    ORDER BY identity.user_id FOR UPDATE;
    IF EXISTS (
        SELECT 1 FROM (
            SELECT target_group.owner_id AS user_id
            UNION SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id
        ) members
        LEFT JOIN public.users identity USING (user_id)
        LEFT JOIN public.students student USING (user_id)
        WHERE identity.role IS DISTINCT FROM 'student'
           OR NOT public.adviser_courses_match(target_group.course, student.course)
    ) THEN RAISE EXCEPTION 'All group members must be students in the group course.'; END IF;
    IF EXISTS (
        SELECT 1 FROM public.students student
        WHERE student.user_id IN (
            SELECT target_group.owner_id
            UNION SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id
        )
        AND student.adviser_id IS NOT NULL AND student.adviser_id <> p_adviser_id
    ) THEN RAISE EXCEPTION 'A group member is already assigned to another adviser.'; END IF;

    IF target_application.expires_at <= clock_timestamp() THEN
        UPDATE public.group_adviser_applications
        SET status = 'Expired', responded_at = expires_at
        WHERE application_id = p_application_id;
        RETURN 'Expired';
    END IF;

    UPDATE public.group_adviser_applications
    SET status = 'Accepted', responded_at = clock_timestamp()
    WHERE application_id = p_application_id;
    UPDATE public.students
    SET adviser_id = p_adviser_id
    WHERE user_id = target_group.owner_id
       OR user_id IN (SELECT user_id FROM public.group_members WHERE group_id = target_group.group_id);
    UPDATE public.groups
    SET adviser_id = p_adviser_id, adviser_assigned_at = clock_timestamp()
    WHERE group_id = target_group.group_id;
    RETURN 'Accepted';
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_assigned_group_member()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE assigned_adviser BIGINT;
BEGIN
    SELECT adviser_id INTO assigned_adviser FROM public.groups WHERE group_id = NEW.group_id FOR UPDATE;
    IF assigned_adviser IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM public.students
            WHERE user_id = NEW.user_id AND adviser_id IS NOT NULL AND adviser_id <> assigned_adviser
        ) THEN RAISE EXCEPTION 'A group member is already assigned to another adviser.'; END IF;
        UPDATE public.students SET adviser_id = assigned_adviser WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS sync_assigned_group_member ON public.group_members;
CREATE TRIGGER sync_assigned_group_member
BEFORE INSERT OR UPDATE ON public.group_members
FOR EACH ROW EXECUTE FUNCTION public.sync_assigned_group_member();

DROP TRIGGER IF EXISTS guard_student_group_adviser ON public.users;
CREATE OR REPLACE FUNCTION public.guard_student_group_adviser()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.groups group_record
        WHERE group_record.adviser_id IS NOT NULL
          AND (group_record.owner_id = NEW.user_id OR EXISTS (
              SELECT 1 FROM public.group_members member
              WHERE member.group_id = group_record.group_id AND member.user_id = NEW.user_id
          ))
          AND group_record.adviser_id IS DISTINCT FROM NEW.adviser_id
    ) THEN RAISE EXCEPTION 'A group member is already assigned to the permanent group adviser.'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS guard_student_group_adviser ON public.students;
CREATE TRIGGER guard_student_group_adviser
BEFORE UPDATE OF adviser_id ON public.students
FOR EACH ROW EXECUTE FUNCTION public.guard_student_group_adviser();

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
    IF target_group.adviser_id IS NOT NULL THEN
        PERFORM user_id FROM public.users WHERE user_id = target_group.adviser_id FOR UPDATE;
    END IF;
    PERFORM user_id FROM public.users WHERE user_id = ANY(member_ids) ORDER BY user_id FOR UPDATE;
    DELETE FROM public.groups WHERE group_id = p_group_id;
    UPDATE public.students student SET adviser_id = NULL
    WHERE student.user_id = ANY(member_ids) AND student.adviser_id IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.groups group_record
          WHERE group_record.adviser_id IS NOT NULL
            AND (group_record.owner_id = student.user_id OR EXISTS (
                SELECT 1 FROM public.group_members member
                WHERE member.group_id = group_record.group_id AND member.user_id = student.user_id
            ))
      );
END;
$$;

CREATE OR REPLACE FUNCTION public.adviser_application_review_json(p_application_id BIGINT, p_adviser_id BIGINT)
RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = public AS $$
    SELECT public.adviser_application_json(application.application_id) || jsonb_build_object(
        'Course', group_record.course, 'MemberCount', members.member_count, 'Members', members.names,
        'Requirements', files.documents, 'FileCount', files.file_count, 'FirstFileName', files.first_name,
        'CanAccept', application.status = 'Pending' AND application.expires_at > clock_timestamp()
            AND group_record.finalized_at IS NOT NULL AND group_record.adviser_id IS NULL
            AND identity.role = 'adviser' AND identity.is_active
            AND (identity.expires_at IS NULL OR identity.expires_at > clock_timestamp())
            AND public.adviser_courses_match(group_record.course, adviser.course)
            AND (SELECT count(*) FROM public.groups WHERE adviser_id = identity.user_id) < adviser.adviser_capacity
            AND NOT EXISTS (
                SELECT 1 FROM (
                    SELECT group_record.owner_id AS user_id
                    UNION SELECT user_id FROM public.group_members WHERE group_id = group_record.group_id
                ) member_ids
                LEFT JOIN public.users student_identity USING (user_id)
                LEFT JOIN public.students student USING (user_id)
                WHERE student_identity.role IS DISTINCT FROM 'student'
                   OR NOT public.adviser_courses_match(group_record.course, student.course)
                   OR (student.adviser_id IS NOT NULL AND student.adviser_id <> identity.user_id)
            ))
    FROM public.group_adviser_applications application
    JOIN public.groups group_record USING (group_id)
    JOIN public.users identity ON identity.user_id = application.adviser_id
    JOIN public.advisers adviser ON adviser.user_id = identity.user_id
    CROSS JOIN LATERAL (
        SELECT count(*) AS member_count,
               coalesce(jsonb_agg(identity.name ORDER BY identity.user_id), '[]'::jsonb) AS names
        FROM (
            SELECT group_record.owner_id AS user_id
            UNION SELECT user_id FROM public.group_members WHERE group_id = group_record.group_id
        ) member_ids
        JOIN public.users identity USING (user_id)
    ) members
    CROSS JOIN LATERAL (
        SELECT count(*) AS file_count,
               (array_agg(document.file_name ORDER BY document.document_id))[1] AS first_name,
               coalesce(jsonb_agg(jsonb_build_object(
                   'DocumentID', document.document_id, 'FileName', document.file_name,
                   'FileType', document.file_type, 'FileSize', document.file_size
               ) ORDER BY document.document_id), '[]'::jsonb) AS documents
        FROM public.group_adviser_application_documents document
        WHERE document.application_id = application.application_id
    ) files
    WHERE application.application_id = p_application_id AND application.adviser_id = p_adviser_id;
$$;

CREATE OR REPLACE FUNCTION public.update_student_profile(
    p_user_id BIGINT, p_first_name TEXT, p_last_name TEXT, p_name TEXT,
    p_bio TEXT, p_gender TEXT, p_socials TEXT, p_birthdate DATE, p_skills TEXT[]
) RETURNS VOID LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    UPDATE public.users
    SET first_name = p_first_name, last_name = p_last_name, name = p_name
    WHERE user_id = p_user_id AND role = 'student';
    IF NOT FOUND THEN RAISE EXCEPTION 'Student account not found.'; END IF;
    UPDATE public.students
    SET bio = p_bio, gender = p_gender, socials = p_socials,
        birthdate = p_birthdate, skills = p_skills
    WHERE user_id = p_user_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Student profile not found.'; END IF;
END;
$$;

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

REVOKE EXECUTE ON FUNCTION public.ensure_role_profile(),
    public.sync_assigned_group_member(), public.guard_student_group_adviser(),
    public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN),
    public.admin_delete_group(BIGINT, BIGINT),
    public.adviser_application_review_json(BIGINT, BIGINT),
    public.update_student_profile(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT[]),
    public.get_adviser_dashboard_report(BIGINT, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_role_profile(),
    public.sync_assigned_group_member(), public.guard_student_group_adviser(),
    public.submit_group_adviser_application(BIGINT, BIGINT, BIGINT),
    public.respond_to_group_adviser_application(BIGINT, BIGINT, BOOLEAN),
    public.admin_delete_group(BIGINT, BIGINT),
    public.adviser_application_review_json(BIGINT, BIGINT),
    public.update_student_profile(BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, DATE, TEXT[]),
    public.get_adviser_dashboard_report(BIGINT, TEXT)
    TO service_role;

DROP INDEX IF EXISTS public.users_adviser_id_idx;
ALTER TABLE public.users
    DROP COLUMN IF EXISTS course,
    DROP COLUMN IF EXISTS year_level,
    DROP COLUMN IF EXISTS specialty,
    DROP COLUMN IF EXISTS skills,
    DROP COLUMN IF EXISTS adviser_id,
    DROP COLUMN IF EXISTS bio,
    DROP COLUMN IF EXISTS requirements,
    DROP COLUMN IF EXISTS adviser_capacity,
    DROP COLUMN IF EXISTS birthdate,
    DROP COLUMN IF EXISTS gender,
    DROP COLUMN IF EXISTS socials;

NOTIFY pgrst, 'reload schema';
COMMIT;
