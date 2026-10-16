-- Apply after 011. Preserve existing notifications, uploads and assignments.
BEGIN;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_notification_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_notification_type_check
    CHECK (notification_type IN ('adviser_application_submitted','adviser_application_accepted','adviser_application_expired'));

CREATE OR REPLACE FUNCTION public.notify_adviser_application_submission()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    INSERT INTO public.notifications(recipient_id, notification_type, title, message, application_id, group_id, event_key, created_at)
    SELECT NEW.adviser_id, 'adviser_application_submitted', 'New group application',
        format('%s submitted an adviser application.', g.group_name), NEW.application_id, NEW.group_id,
        'adviser-application:' || NEW.application_id || ':Pending', NEW.created_at
    FROM public.groups g WHERE g.group_id = NEW.group_id AND g.finalized_at IS NOT NULL AND NEW.status = 'Pending'
    ON CONFLICT (event_key) DO NOTHING;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notify_adviser_application_submission ON public.group_adviser_applications;
CREATE TRIGGER notify_adviser_application_submission AFTER INSERT ON public.group_adviser_applications
    FOR EACH ROW EXECUTE FUNCTION public.notify_adviser_application_submission();

-- Actual application metadata, separate from member portfolio uploads. This is
-- service-only; the public API and the detail RPC below verify the recipient.
CREATE OR REPLACE FUNCTION public.adviser_application_review_json(p_application_id BIGINT, p_adviser_id BIGINT)
RETURNS JSONB LANGUAGE sql VOLATILE SET search_path = public AS $$
    SELECT public.adviser_application_json(a.application_id) || jsonb_build_object(
        'Course', g.course, 'MemberCount', members.member_count, 'Members', members.names,
        'Requirements', files.documents, 'FileCount', files.file_count, 'FirstFileName', files.first_name,
        'CanAccept', a.status = 'Pending' AND a.expires_at > clock_timestamp()
            AND g.finalized_at IS NOT NULL AND g.adviser_id IS NULL
            AND u.role = 'adviser' AND u.is_active AND (u.expires_at IS NULL OR u.expires_at > clock_timestamp())
            AND public.adviser_courses_match(g.course, u.course)
            AND (SELECT count(*) FROM public.groups WHERE adviser_id = u.user_id) < u.adviser_capacity
            AND NOT EXISTS (SELECT 1 FROM public.users student WHERE student.user_id IN
                (SELECT user_id FROM public.group_members WHERE group_id = g.group_id UNION SELECT g.owner_id)
                AND (student.role <> 'student' OR NOT public.adviser_courses_match(g.course, student.course)
                    OR (student.adviser_id IS NOT NULL AND student.adviser_id <> u.user_id))))
    FROM public.group_adviser_applications a JOIN public.groups g USING(group_id)
    JOIN public.users u ON u.user_id = a.adviser_id
    CROSS JOIN LATERAL (SELECT count(*) AS member_count, coalesce(jsonb_agg(s.name ORDER BY s.user_id), '[]'::jsonb) AS names
        FROM public.users s WHERE s.user_id IN
        (SELECT user_id FROM public.group_members WHERE group_id = g.group_id UNION SELECT g.owner_id)) members
    CROSS JOIN LATERAL (SELECT count(*) AS file_count,
        (array_agg(d.file_name ORDER BY d.document_id))[1] AS first_name,
        coalesce(jsonb_agg(jsonb_build_object('DocumentID', d.document_id, 'FileName', d.file_name,
            'FileType', d.file_type, 'FileSize', d.file_size) ORDER BY d.document_id), '[]'::jsonb) AS documents
        FROM public.group_adviser_application_documents d WHERE d.application_id = a.application_id) files
    WHERE a.application_id = p_application_id AND a.adviser_id = p_adviser_id;
$$;

CREATE OR REPLACE FUNCTION public.get_adviser_application_review(p_application_id BIGINT, p_adviser_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE application public.group_adviser_applications;
BEGIN
    SELECT * INTO application FROM public.group_adviser_applications WHERE application_id = p_application_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    IF p_adviser_id IS NULL OR application.adviser_id IS DISTINCT FROM p_adviser_id THEN
        RAISE EXCEPTION 'Only the selected adviser can view this application.';
    END IF;
    PERFORM public.expire_group_adviser_applications(application.group_id);
    RETURN public.adviser_application_review_json(p_application_id, p_adviser_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_notifications(p_recipient_id BIGINT, p_before_id BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE items JSONB; unread_count BIGINT; more BOOLEAN; last_id BIGINT;
BEGIN
    SELECT coalesce(jsonb_agg((to_jsonb(n) - 'recipient_id' - 'event_key') ||
        jsonb_build_object('application', CASE WHEN n.notification_type = 'adviser_application_submitted'
            THEN public.adviser_application_review_json(n.application_id, p_recipient_id) - 'Requirements' - 'Members' ELSE NULL END)
        ORDER BY notification_id DESC), '[]'::jsonb), min(notification_id)
    INTO items, last_id FROM (SELECT * FROM public.notifications WHERE recipient_id = p_recipient_id
        AND (p_before_id IS NULL OR notification_id < p_before_id) ORDER BY notification_id DESC LIMIT 20) n;
    SELECT count(*) INTO unread_count FROM public.notifications WHERE recipient_id = p_recipient_id AND read_at IS NULL;
    SELECT EXISTS(SELECT 1 FROM public.notifications WHERE recipient_id = p_recipient_id AND notification_id < last_id) INTO more;
    RETURN jsonb_build_object('items', items, 'unreadCount', unread_count, 'hasMore', more, 'nextCursor', last_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.notify_adviser_application_submission(),
    public.adviser_application_review_json(BIGINT,BIGINT), public.get_adviser_application_review(BIGINT,BIGINT),
    public.get_user_notifications(BIGINT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_adviser_application_submission(),
    public.adviser_application_review_json(BIGINT,BIGINT), public.get_adviser_application_review(BIGINT,BIGINT),
    public.get_user_notifications(BIGINT,BIGINT) TO service_role;

-- One real notification for each existing, still-pending finalized application.
-- No demo records or notifications for historical terminal applications.
INSERT INTO public.notifications(recipient_id, notification_type, title, message, application_id, group_id, event_key, created_at)
SELECT a.adviser_id, 'adviser_application_submitted', 'New group application',
    format('%s submitted an adviser application.', g.group_name), a.application_id, a.group_id,
    'adviser-application:' || a.application_id || ':Pending', a.created_at
FROM public.group_adviser_applications a JOIN public.groups g USING(group_id)
WHERE a.status = 'Pending' AND a.expires_at > clock_timestamp() AND g.finalized_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
