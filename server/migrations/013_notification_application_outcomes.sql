-- Apply after 012. Enrich existing events; no new accounts, applications or uploads.
BEGIN;
CREATE OR REPLACE FUNCTION public.get_user_notifications(p_recipient_id BIGINT, p_before_id BIGINT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SET search_path = public AS $$
DECLARE items JSONB; unread_count BIGINT; more BOOLEAN; last_id BIGINT;
BEGIN
    SELECT coalesce(jsonb_agg((to_jsonb(n) - 'recipient_id' - 'event_key') ||
        jsonb_build_object('application', CASE WHEN n.notification_type = 'adviser_application_submitted'
            THEN public.adviser_application_review_json(n.application_id, p_recipient_id) - 'Requirements' - 'Members' ELSE NULL END,
            'outcome', CASE WHEN n.notification_type IN ('adviser_application_accepted','adviser_application_expired')
                AND EXISTS (SELECT 1 FROM public.group_adviser_applications a
                    WHERE a.application_id = n.application_id AND a.applicant_id = p_recipient_id)
                THEN public.adviser_application_json(n.application_id) ELSE NULL END)
        ORDER BY notification_id DESC), '[]'::jsonb), min(notification_id)
    INTO items, last_id FROM (SELECT * FROM public.notifications WHERE recipient_id = p_recipient_id
        AND (p_before_id IS NULL OR notification_id < p_before_id) ORDER BY notification_id DESC LIMIT 20) n;
    SELECT count(*) INTO unread_count FROM public.notifications WHERE recipient_id = p_recipient_id AND read_at IS NULL;
    SELECT EXISTS(SELECT 1 FROM public.notifications WHERE recipient_id = p_recipient_id AND notification_id < last_id) INTO more;
    RETURN jsonb_build_object('items', items, 'unreadCount', unread_count, 'hasMore', more, 'nextCursor', last_id);
END;
$$;


REVOKE EXECUTE ON FUNCTION public.get_user_notifications(BIGINT,BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_notifications(BIGINT,BIGINT) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
