# JuanFinder

## Supabase setup

1. Create a Supabase project.
2. Open the Supabase SQL Editor and run [`server/database.sql`](server/database.sql). It creates the PostgreSQL tables, indexes, transaction-safe group functions, and sample accounts.
3. Use `server/.env.example` as a template and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to `server/.env`. Preserve any existing values if you still need them to export data from SQL Server. Keep the service-role key server-side; never put it in a `VITE_` variable or commit `server/.env`.
4. Install and start the API:

   ```powershell
   cd server
   npm install
   npm start
   ```

5. In another terminal at the repository root, start the frontend:

   ```powershell
   npm install
   npm run dev
   ```

The API listens on `http://localhost:5000`; Vite defaults to `http://localhost:5173`.

## Vercel deployment

The frontend and Express API are served from the same Vercel deployment. In the Vercel project settings, add these environment variables for Production (and Preview too if you use preview deployments):

- `SUPABASE_URL`: your Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: the Supabase service-role key. Keep it server-side; never use a `VITE_` prefix.
- `FRONTEND_URL`: `https://juanfinder.vercel.app` (use the exact deployed origin; comma-separate additional allowed origins if needed).

Do not set `VITE_API_URL` in Vercel for this same-domain setup. Production API calls use `/api`; local development continues to use `http://localhost:5000`. Redeploy after changing environment variables.

Sample accounts created by the SQL script:

- Student: `juan@sti.edu.ph` / `juan123`
- Adviser: `orbase@sti.edu.ph` / `adviser123`
- Admin: `admin` / `admin123`

Change or remove these sample credentials before using a production project. The SQL script creates the Supabase schema and sample accounts; it does not transfer existing rows from a separate SQL Server database. Existing data must be exported from that server and imported into Supabase separately.

## Local AI capstone title generation

The first implementation of the AI workflow is available in `ai-service/`. It adds a local FastAPI service that uses Ollama to analyze member documents and generate title options. The existing Express API proxies AI requests and checks that the requesting student is a member of the target group.

Follow [the AI service setup guide](ai-service/README.md). Before using the new endpoints, run `server/ai-schema.sql` in the Supabase SQL Editor and set `AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env`.

The AI panel appears on **My Group** for approved members. Each member can upload a PDF, DOCX, or TXT file (maximum 10 MB), analyze it, and save an extracted skills profile. Once profiles have been uploaded, the group can generate title options and save one selected title.

This is a local-development prototype. Scanned PDFs are not supported in this first version, and adviser matching is not yet connected to the title-selection flow. Do not expose the Ollama port or AI service publicly. Before production deployment, replace the existing `x-user-id` header authentication with verified Supabase Auth tokens and enforce authorization server-side.
