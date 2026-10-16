-- Read-only diagnostic. Run in the Supabase SQL Editor before/after migrations.
SELECT name, to_regclass('public.' || name) IS NOT NULL AS present
FROM unnest(ARRAY['users','groups','group_members','auth_sessions','group_join_requests',
    'group_adviser_applications','group_adviser_application_documents','adviser_slot_availability',
    'notifications','pending_adviser_applications']) name;

SELECT required.table_name, required.column_name, c.column_name IS NOT NULL AS present
FROM (VALUES ('groups','finalized_at'), ('groups','adviser_id'), ('groups','adviser_assigned_at'),
    ('users','adviser_capacity'), ('users','expires_at'), ('group_join_requests','expires_at'),
    ('group_adviser_applications','expires_at'), ('notifications','read_at')) required(table_name,column_name)
LEFT JOIN information_schema.columns c ON c.table_schema='public'
    AND c.table_name=required.table_name AND c.column_name=required.column_name;

SELECT signature, to_regprocedure('public.' || signature) IS NOT NULL AS present,
    CASE WHEN to_regprocedure('public.' || signature) IS NOT NULL
        THEN has_function_privilege('service_role', 'public.' || signature, 'EXECUTE') END AS service_can_execute,
    CASE WHEN to_regprocedure('public.' || signature) IS NOT NULL
        THEN has_function_privilege('anon', 'public.' || signature, 'EXECUTE') END AS anon_can_execute,
    CASE WHEN to_regprocedure('public.' || signature) IS NOT NULL
        THEN has_function_privilege('authenticated', 'public.' || signature, 'EXECUTE') END AS authenticated_can_execute
FROM unnest(ARRAY['finalize_group(bigint,bigint)', 'expire_juan_finder_records()',
    'adviser_courses_match(text,text)',
    'admin_delete_group(bigint,bigint)',
    'expire_group_adviser_applications(bigint)',
    'get_group_adviser_application(bigint,bigint)',
    'get_adviser_application(bigint,bigint)',
    'get_user_notifications(bigint,bigint)',
    'mark_user_notification_read(bigint,bigint)',
    'get_adviser_application_review(bigint,bigint)',
    'adviser_application_review_json(bigint,bigint)',
    'submit_group_adviser_application(bigint,bigint,bigint)',
    'respond_to_group_adviser_application(bigint,bigint,boolean)',
    'submit_group_adviser_application_with_document(bigint,bigint,bigint,jsonb)',
    'submit_group_adviser_application_with_documents(bigint,bigint,bigint,jsonb)']) signature;

SELECT c.relname, c.relrowsecurity AS rls_enabled,
    (has_table_privilege('service_role', c.oid, 'SELECT')
        AND has_table_privilege('service_role', c.oid, 'INSERT')
        AND has_table_privilege('service_role', c.oid, 'UPDATE')
        AND has_table_privilege('service_role', c.oid, 'DELETE')) AS service_has_access,
    has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_read,
    has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('group_adviser_applications','group_adviser_application_documents');

SELECT c.relname, (has_sequence_privilege('service_role', c.oid, 'USAGE')
    AND has_sequence_privilege('service_role', c.oid, 'SELECT')) AS service_has_access
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
    AND c.relkind='S' AND c.relname LIKE 'group_adviser_application%';

SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public'
    AND tablename='group_adviser_applications';

-- Notifications intentionally grant SELECT/INSERT/UPDATE, without DELETE.
SELECT c.relrowsecurity AS rls_enabled,
    has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE') AS service_has_access,
    has_table_privilege('anon', c.oid, 'SELECT') AS anon_can_read,
    has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_can_read
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname='notifications';
SELECT extname FROM pg_extension WHERE extname='pg_cron';
-- See ADVISER_WORKFLOW.md for job verification and the external scheduler alternative.

-- Read-only event/recipient diagnostics; no names, tokens or file paths.
SELECT n.notification_type, u.role AS recipient_role, count(*) AS event_count,
    count(*) FILTER (WHERE n.read_at IS NULL) AS unread_count
FROM public.notifications n JOIN public.users u ON u.user_id = n.recipient_id
GROUP BY n.notification_type, u.role;

SELECT count(*) AS pending_applications_missing_adviser_event
FROM public.group_adviser_applications a JOIN public.groups g USING (group_id)
WHERE a.status = 'Pending' AND a.expires_at > clock_timestamp() AND g.finalized_at IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.application_id = a.application_id
    AND n.recipient_id = a.adviser_id AND n.notification_type = 'adviser_application_submitted');

SELECT a.status, count(*) AS application_count,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.group_adviser_application_documents d
        WHERE d.application_id = a.application_id)) AS applications_without_attachment_metadata
FROM public.group_adviser_applications a GROUP BY a.status;

SELECT count(*) AS mismatched_document_owners
FROM public.group_adviser_application_documents d JOIN public.group_adviser_applications a USING(application_id)
WHERE d.adviser_id IS DISTINCT FROM a.adviser_id OR d.uploaded_by IS DISTINCT FROM a.applicant_id
    OR d.group_id IS DISTINCT FROM a.group_id;
