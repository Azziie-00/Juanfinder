# JuanFinder AI service (local development)

This service extracts text from student documents and calls Ollama for profile extraction and capstone-title generation. The Express API proxies requests and verifies that the signed-in user belongs to the target group before uploading or generating titles.

## 1. Install prerequisites (Windows)

1. Install Ollama from https://ollama.com/download.
2. In PowerShell, run `ollama pull llama3.2:1b`.
3. Install Python 3.11 or newer.
4. From the repository root:

   ```powershell
   cd ai-service
   py -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   Copy-Item .env.example .env
   uvicorn main:app --host 127.0.0.1 --port 8001
   ```

5. In a second terminal, set `AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env` and start the existing API:

   ```powershell
   cd server
   npm install
   npm start
   ```

6. Check `http://127.0.0.1:8001/health` and `http://localhost:5000/api/ai/health`.

## 2. Database

Run `server/ai-schema.sql` in Supabase SQL Editor. This creates a private-by-default table for each group member's extracted profile and a table for the selected capstone title.

## 3. API flow

- `POST /api/ai/groups/:groupId/analyze-member?filename=resume.pdf` with an `application/octet-stream` body. The body is the original file bytes.
- `POST /api/ai/groups/:groupId/generate-titles` generates three title options from the group's saved profiles.
- `POST /api/ai/groups/:groupId/select-title` with JSON `{ "title": { ...one returned title object... } }` saves the group's selected title.
- `GET /api/ai/groups/:groupId/profiles` returns the saved extracted profiles to group members.
- `GET /api/ai/groups/:groupId/selected-title` returns the selected title, if one exists.

Allowed formats are PDF, DOCX, and TXT, up to 10 MB and 30 PDF pages. Scanned PDFs are rejected with a clear message in this first version; OCR can be added after the basic flow works.

## Important deployment note

This is a local-development setup. Ollama and this service must not be exposed directly to the public internet. A Vercel-hosted Express function cannot reach Ollama on your personal computer unless the AI service is deployed on a securely reachable machine with authentication and TLS. Do not deploy this configuration unchanged.

The existing application authenticates API requests using the `x-user-id` header. That is not secure authentication for a public deployment by itself. Before production, replace it with verified Supabase Auth access tokens and enforce membership checks server-side. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
