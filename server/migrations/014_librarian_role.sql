-- Apply after migration 013 to allow librarian accounts in the shared users table.
BEGIN;

DO $$
DECLARE
    role_check RECORD;
BEGIN
    FOR role_check IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.users'::regclass
            AND contype = 'c'
            AND pg_get_constraintdef(oid) ILIKE '%role%'
    LOOP
        EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', role_check.conname);
    END LOOP;
END;
$$;

ALTER TABLE public.users
    ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'adviser', 'admin', 'superadmin', 'library'));

NOTIFY pgrst, 'reload schema';
COMMIT;
