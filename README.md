# JuanFinder

For an existing database with adviser application or slot problems, follow the [adviser workflow repair guide](server/ADVISER_WORKFLOW.md). It includes the confirmed diagnosis, read-only schema/permission checks, and the exact additive SQL order. Do not rerun the sample-account setup below as a repair.

## Supabase setup

1. Create or select a Supabase project.
2. In its SQL Editor, run [`server/database.sql`](server/database.sql). It creates the PostgreSQL tables, indexes, transaction-safe group functions, and sample accounts.
3. In the same SQL Editor, run [`server/migrations/001_capstone_workflows.sql`](server/migrations/001_capstone_workflows.sql). This additive migration adds profiles, private portfolios, API sessions, temporary access, group finalization, expiring join requests, and audited admin membership overrides. Apply it after `database.sql`; do not rerun `database.sql` against a production database because it also creates sample accounts.
4. Run [`server/migrations/002_group_adviser_applications.sql`](server/migrations/002_group_adviser_applications.sql) after migration 001 to enable persisted group adviser applications. This is additive and does not modify existing user, group, or membership records.
5. Run [`server/migrations/003_unspecified_course_advisers.sql`](server/migrations/003_unspecified_course_advisers.sql) after migration 002 to keep active advisers whose course is blank or `Unspecified` available to students across courses.
6. Run [`server/migrations/004_restore_all_adviser_availability.sql`](server/migrations/004_restore_all_adviser_availability.sql) after migration 003 to list active advisers from all courses and allow applications across courses while retaining the existing 10-group default capacity.
7. Run [`server/migrations/005_adviser_slot_capacity.sql`](server/migrations/005_adviser_slot_capacity.sql) after migration 004. It adds a per-adviser slot capacity (default 10, including for existing advisers) and updates adviser application checks to enforce that configured capacity. Set an adviser's capacity in **Admin → Advisers → Edit User → Adviser Slot Capacity**. Use 0 to stop new applications.
8. Run [`server/migrations/006_group_adviser_application_requirements.sql`](server/migrations/006_group_adviser_application_requirements.sql) after migration 005 to store metadata for optional group-application requirements files in the private `student-portfolios` bucket.

   Then run [`server/migrations/007_atomic_adviser_assignments.sql`](server/migrations/007_atomic_adviser_assignments.sql) to persist group adviser assignments and enforce atomic acceptance and per-group capacity accounting. Run [`server/migrations/008_match_adviser_group_courses.sql`](server/migrations/008_match_adviser_group_courses.sql) to require matching configured courses for new applications and acceptance while preserving existing accepted assignments. Run [`server/migrations/009_delete_group_adviser_cleanup.sql`](server/migrations/009_delete_group_adviser_cleanup.sql) so admin group deletion also releases its members' adviser assignments. Then run [`server/migrations/010_application_multiple_files.sql`](server/migrations/010_application_multiple_files.sql) to allow up to five application files with a combined 10 MB limit. Finally apply [migration 011](server/migrations/011_notifications_and_application_expiry.sql) for persistent notifications and 24-hour application expiration; verify the scheduler using the [workflow guide](server/ADVISER_WORKFLOW.md). Apply [migration 012](server/migrations/012_adviser_submission_notifications.sql) for selected-adviser submission notifications and secure application/file details, [migration 013](server/migrations/013_notification_application_outcomes.sql) for application outcome notifications, [migration 014](server/migrations/014_librarian_role.sql) to allow librarian accounts, and [migration 015](server/migrations/015_separate_role_profiles.sql) to move student and adviser profile data out of the shared login table. Migration 015 preserves existing accounts and related records.
9. The first migration creates the private `student-portfolios` Storage bucket. Uploads and previews are mediated by the server using the service-role key; do not make the bucket public or expose that key to the browser. The migration attempts to schedule request/account expiration every five minutes with `pg_cron`. If that extension is unavailable, configure a Supabase scheduled database job to run `SELECT public.expire_juan_finder_records();` every five minutes.
10. In Supabase Project Settings, copy the project URL and the server-side `service_role` key (or secret API key, if your project uses the newer key format). Keep the key private.
11. Create `server/.env` from [`server/.env.example`](server/.env.example), then set the project URL and key:

   ```env
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-private-server-side-key
   FRONTEND_URL=http://localhost:5173
   PORT=5000
   ```

   Use your actual Supabase project URL. Never put the service key in a `VITE_` variable, frontend code, or a committed file. `.env` files are ignored by Git. Preserve any existing values if you still need them to export data from SQL Server.

12. Install and start the API:

   ```powershell
   cd path\to\Juanfinder
   npm install
   npm run server
   ```

13. In a second terminal at the project root, start the frontend:

   ```powershell
   npm run dev
   ```

The API listens on `http://localhost:5000`; Vite defaults to `http://localhost:5173`. The frontend uses the local API automatically in development. Check `http://localhost:5000/api/health/db` for the database connection status.

After applying migrations 014 and 015, administrators can open **Admin → Library → Add Library** to create a librarian account using only a username and password. The server generates its internal user code, hashes the password, and creates the account without an expiration date. The librarian can then sign in by selecting **Library** on the JuanFinder login screen. If the form reports **API endpoint not found**, restart the local API or redeploy the latest backend together with the frontend; the current backend exposes the Library account creation endpoint.

The migration is designed to preserve existing user, group, and request rows. Before production use, take a Supabase backup and review the SQL against your project. PostgreSQL DDL changes and the private Storage bucket change are not automatically rolled back if a later statement fails; inspect the SQL Editor error and database state before retrying.

## Vercel deployment

The frontend and Express API are served from the same Vercel deployment. Set the Vercel project root to the `Juanfinder` folder, then open **Project Settings → Environment Variables** and add these variables. Apply them to Production and, if applicable, Preview:

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the private server-side `service_role` key (or secret API key). Do not use a `VITE_` prefix.
- `FRONTEND_URL`: the exact deployed website origin, for example `https://your-project.vercel.app`. If you use a custom domain or additional origins, comma-separate the exact origins.

Do not set `VITE_API_URL` in Vercel for this same-domain setup. Production API calls use `/api` on the Vercel domain; local development uses `http://localhost:5000`. Save the variables and redeploy so the serverless API receives them. Verify the deployed connection at `https://your-project.vercel.app/api/health/db`.

For a new installation, run `server/database.sql` and migrations 001 through 015 in order in the Supabase SQL Editor for the project used by both localhost and Vercel; the app does not run schema migrations automatically. For an existing installation, use the [repair guide](server/ADVISER_WORKFLOW.md) and apply missing migrations without rerunning sample-account setup. Migration 005 adds configurable capacity, 006 adds application requirements, 007 persists adviser assignments and enforces atomic acceptance, 014 enables Librarian accounts, and 015 moves role-specific student/adviser data into separate tables while retaining `users` for shared authentication. Configure the scheduled expiration job as described above if `pg_cron` was unavailable.

Sample accounts created by the SQL script:

- Student: `juan@sti.edu.ph` / `juan123`
- Adviser: `orbase@sti.edu.ph` / `adviser123`
- Admin: `admin` / `admin123`

Change or remove these sample credentials before using a production project. The SQL script creates the Supabase schema and sample accounts; it does not transfer existing rows from a separate SQL Server database. Existing data must be exported from that server and imported into Supabase separately.

## Local AI capstone title generation

The first implementation of the AI workflow is available in `ai-service/`. It adds a local FastAPI service that uses Ollama to analyze member documents and generate title options. The existing Express API proxies AI requests and checks that the requesting student is a member of the target group.

Follow [the AI service setup guide](ai-service/README.md). Before using the new endpoints, run `server/ai-schema.sql` in the Supabase SQL Editor and set `AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env`.

The AI panel appears on **My Group** for approved members. Each member can upload a PDF, DOCX, or TXT file (maximum 10 MB), analyze it, and save an extracted skills profile. Once profiles have been uploaded, the group can generate title options and save one selected title.

AI group endpoints require an authenticated session and verify group membership on the server. Dashboard adviser matching also uses the selected capstone title when one has been saved. Keep Ollama private and protect any remotely hosted AI service with the shared service token.

## Recommended groups with Llama 3.2 1B

Students without a group or pending join request can open **Dashboard → Recommended groups → Find my matches** to get up to three open group recommendations based on the skills saved in **Profile**. Each suggestion explains the fit, shows matching skills and available places, and offers a Request to join action in the Dashboard panel. Empty profiles link to Profile; unavailable AI and no-match results leave normal browsing available.

1. Follow [the AI service setup guide](ai-service/README.md), then run `ollama pull llama3.2:1b` on the AI host.
2. Copy `ai-service/.env.example` to `ai-service/.env` and replace `AI_SERVICE_TOKEN` with a long random secret. Set the **same** token in `server/.env`, along with `AI_SERVICE_URL` pointing to the AI service. Restart both services. All JuanFinder AI features use the fixed `llama3.2:1b` model, including recommendations, chat, CV analysis, and title generation. Model environment overrides are not used.
3. Save skills in the student's Profile, then use the Dashboard recommendation panel. No new database migration is required beyond the existing profile/group migrations.

`POST /api/groups/recommendations` requires the existing authenticated student session and takes no client-supplied student ID, skills, or candidates. The server loads profile skills and excludes full, finalized, closed, other-course groups and students with existing memberships, ownership, or unexpired pending requests. It shortlists up to 12 candidates by direct skill overlap; Llama ranks semantic fit and returns up to three matches. Only supplied group IDs and actual profile skills are accepted. Eligibility is checked again after inference, and joining still uses the existing transactional eligibility checks. Only skills, group IDs, specialties, and descriptions are sent to the AI service; names, contact details, and uploaded documents are not included.

Group discovery is independent of the one-time capstone-title quota and does not consume or reset it. Recommendations are generated on demand and are not persisted. For Vercel, configure the shared token and a server-reachable authenticated HTTPS `AI_SERVICE_URL`; localhost cannot reach the AI running on a personal computer. Ensure the hosting request timeout supports the inference duration.

Verification: `npm run build`, `npm run lint`, `node --test server/group-recommendations.test.js`, and (from `ai-service`) `python -m unittest test_group_recommendations.py`.

## Recommended advisers with Llama 3.2 1B

Students who belong to a group can select **Dashboard → Recommended adviser → Find my adviser**. The saved group title, description, and selected capstone title are matched against available same-course advisers' profile expertise. Cards explain the fit and link to the existing application process. Recommended Groups displays one group at a time in a 360px panel with Previous/Next navigation; Recommended Adviser stays 180px tall. Long content scrolls internally.

Restart the AI and backend services after updating. See the [adviser recommendation guide](docs/adviser-recommendations.md) for eligibility, model limitations, deployment configuration and validation commands.

## Temporary access

Temporary access passwords are generated randomly and displayed to an administrator once when issued. Share them with the account holder through a secure channel. Accounts expire after seven days and must change their password at their next login.
