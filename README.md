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

Sample accounts created by the SQL script:

- Student: `juan@sti.edu.ph` / `juan123`
- Adviser: `orbase@sti.edu.ph` / `adviser123`
- Admin: `admin` / `admin123`

Change or remove these sample credentials before using a production project. The SQL script creates the Supabase schema and sample accounts; it does not transfer existing rows from a separate SQL Server database. Existing data must be exported from that server and imported into Supabase separately.
