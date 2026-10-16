-- Preserve existing single-file applications; allow at most five files / 10 MiB total.
BEGIN;
ALTER TABLE public.group_adviser_application_documents
    DROP CONSTRAINT IF EXISTS group_adviser_application_documents_application_id_key;
CREATE INDEX IF NOT EXISTS group_adviser_application_documents_application_idx
    ON public.group_adviser_application_documents(application_id);

CREATE OR REPLACE FUNCTION public.check_application_document_limits()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    application public.group_adviser_applications;
    file_count INTEGER;
    total_size BIGINT;
BEGIN
    -- Serialize concurrent inserts for the same application.
    SELECT * INTO application FROM public.group_adviser_applications WHERE application_id = NEW.application_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Adviser application not found.'; END IF;
    IF NEW.group_id IS DISTINCT FROM application.group_id OR NEW.adviser_id IS DISTINCT FROM application.adviser_id
        OR NEW.uploaded_by IS DISTINCT FROM application.applicant_id THEN
        RAISE EXCEPTION 'Document ownership does not match its application.';
    END IF;
    SELECT count(*), coalesce(sum(file_size), 0) INTO file_count, total_size
    FROM public.group_adviser_application_documents
    WHERE application_id = NEW.application_id AND document_id <> NEW.document_id;
    IF file_count >= 5 THEN RAISE EXCEPTION 'An application allows at most 5 files.'; END IF;
    IF total_size + NEW.file_size > 10485760 THEN RAISE EXCEPTION 'Application files must total no more than 10 MB.'; END IF;
    RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS check_application_document_limits ON public.group_adviser_application_documents;
CREATE TRIGGER check_application_document_limits BEFORE INSERT OR UPDATE ON public.group_adviser_application_documents
    FOR EACH ROW EXECUTE FUNCTION public.check_application_document_limits();

CREATE OR REPLACE FUNCTION public.submit_group_adviser_application_with_documents(
    p_group_id BIGINT, p_applicant_id BIGINT, p_adviser_id BIGINT, p_documents JSONB
) RETURNS BIGINT LANGUAGE plpgsql SET search_path = public AS $$
DECLARE new_id BIGINT;
BEGIN
    IF jsonb_typeof(p_documents) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Application files must be an array.'; END IF;
    IF jsonb_array_length(p_documents) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'An application allows 1 to 5 files.'; END IF;
    IF (SELECT sum((file->>'file_size')::bigint) FROM jsonb_array_elements(p_documents) file) > 10485760 THEN
        RAISE EXCEPTION 'Application files must total no more than 10 MB.';
    END IF;
    new_id := public.submit_group_adviser_application(p_group_id, p_applicant_id, p_adviser_id);
    INSERT INTO public.group_adviser_application_documents
        (application_id, group_id, adviser_id, uploaded_by, file_name, storage_path, file_type, file_size)
    SELECT new_id, p_group_id, p_adviser_id, p_applicant_id, file->>'file_name', file->>'storage_path',
        file->>'file_type', (file->>'file_size')::bigint FROM jsonb_array_elements(p_documents) file;
    RETURN new_id;
END;
$$;
-- Preserve compatibility with the earlier single-file API and saved records.
CREATE OR REPLACE FUNCTION public.submit_group_adviser_application_with_document(
    p_group_id BIGINT, p_applicant_id BIGINT, p_adviser_id BIGINT, p_document JSONB
) RETURNS BIGINT LANGUAGE sql SET search_path = public AS $$
    SELECT public.submit_group_adviser_application_with_documents(p_group_id, p_applicant_id, p_adviser_id, jsonb_build_array(p_document));
$$;
REVOKE EXECUTE ON FUNCTION public.check_application_document_limits(),
    public.submit_group_adviser_application_with_documents(BIGINT, BIGINT, BIGINT, JSONB),
    public.submit_group_adviser_application_with_document(BIGINT, BIGINT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_application_document_limits(),
    public.submit_group_adviser_application_with_documents(BIGINT, BIGINT, BIGINT, JSONB),
    public.submit_group_adviser_application_with_document(BIGINT, BIGINT, BIGINT, JSONB) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
