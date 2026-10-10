# JuanFinder

## Supabase setup

1. Create or select a Supabase project.
2. In its SQL Editor, run [`server/database.sql`](server/database.sql). It creates the PostgreSQL tables, indexes, transaction-safe group functions, and sample accounts.
3. In the same SQL Editor, run [`server/migrations/001_capstone_workflows.sql`](server/migrations/001_capstone_workflows.sql). This additive migration adds profiles, private portfolios, API sessions, temporary access, group finalization, expiring join requests, and audited admin membership overrides. Apply it after `database.sql`; do not rerun `database.sql` against a production database because it also creates sample accounts.
4. The migration creates the private `student-portfolios` Storage bucket. Uploads and previews are mediated by the server using the service-role key; do not make the bucket public or expose that key to the browser. The migration attempts to schedule request/account expiration every five minutes with `pg_cron`. If that extension is unavailable, configure a Supabase scheduled database job to run `SELECT public.expire_juan_finder_records();` every five minutes.
5. In Supabase Project Settings, copy the project URL and the server-side `service_role` key (or secret API key, if your project uses the newer key format). Keep the key private.
6. Create `server/.env` from [`server/.env.example`](server/.env.example), then set the project URL and key:

   ```env
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-private-server-side-key
   FRONTEND_URL=http://localhost:5173
   PORT=5000
   ```

   Use your actual Supabase project URL. Never put the service key in a `VITE_` variable, frontend code, or a committed file. `.env` files are ignored by Git. Preserve any existing values if you still need them to export data from SQL Server.

7. Install and start the API:

   ```powershell
   cd path\to\Juanfinder
   npm install
   npm run server
   ```

8. In a second terminal at the project root, start the frontend:

   ```powershell
   npm run dev
   ```

The API listens on `http://localhost:5000`; Vite defaults to `http://localhost:5173`. The frontend uses the local API automatically in development. Check `http://localhost:5000/api/health/db` for the database connection status.

The migration is designed to preserve existing user, group, and request rows. Before production use, take a Supabase backup and review the SQL against your project. PostgreSQL DDL changes and the private Storage bucket change are not automatically rolled back if a later statement fails; inspect the SQL Editor error and database state before retrying.

## Vercel deployment

The frontend and Express API are served from the same Vercel deployment. Set the Vercel project root to the `Juanfinder` folder, then open **Project Settings → Environment Variables** and add these variables. Apply them to Production and, if applicable, Preview:

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the private server-side `service_role` key (or secret API key). Do not use a `VITE_` prefix.
- `FRONTEND_URL`: the exact deployed website origin, for example `https://your-project.vercel.app`. If you use a custom domain or additional origins, comma-separate the exact origins.

Do not set `VITE_API_URL` in Vercel for this same-domain setup. Production API calls use `/api` on the Vercel domain; local development uses `http://localhost:5000`. Save the variables and redeploy so the serverless API receives them. Verify the deployed connection at `https://your-project.vercel.app/api/health/db`.

Run the migration once in the Supabase SQL Editor for the Supabase project used by both localhost and Vercel; the app does not run schema migrations automatically. Configure the scheduled expiration job as described above if `pg_cron` was unavailable.

Sample accounts created by the SQL script:

- Student: `juan@sti.edu.ph` / `juan123`
- Adviser: `orbase@sti.edu.ph` / `adviser123`
- Admin: `admin` / `admin123`

Change or remove these sample credentials before using a production project. The SQL script creates the Supabase schema and sample accounts; it does not transfer existing rows from a separate SQL Server database. Existing data must be exported from that server and imported into Supabase separately.

## Local AI capstone title generation

The first implementation of the AI workflow is available in `ai-service/`. It adds a local FastAPI service that uses Ollama to analyze member documents and generate title options. The existing Express API proxies AI requests and checks that the requesting student is a member of the target group.

Follow [the AI service setup guide](ai-service/README.md). Before using the new endpoints, run `server/ai-schema.sql` in the Supabase SQL Editor and set `AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env`.

The AI panel appears on **My Group** for approved members. Each member can upload a PDF, DOCX, or TXT file (maximum 10 MB), analyze it, and save an extracted skills profile. Once profiles have been uploaded, the group can generate title options and save one selected title.

This is a local-development prototype. Scanned PDFs are not supported in this first version, and adviser matching is not yet connected to the title-selection flow. Do not expose the Ollama port or AI service publicly. AI group endpoints require an authenticated session and verify group membership on the server.

## Temporary access

Temporary access passwords are generated randomly and displayed to an administrator once when issued. Share them with the account holder through a secure channel. Accounts expire after seven days and must change their password at their next login.
