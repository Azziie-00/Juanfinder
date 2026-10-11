# JuanFinder AI service (local development)

This service extracts text from student CVs and documents and calls Ollama for profile extraction and capstone-title generation. CV analysis is course-aware for BSIT, BSCS, BS Tourism Management, BSCpE, BSBA, BSAIS, BSHM, and BACOMM. Express supplies the signed-in student's registered course from the Supabase user record. The API proxies requests and protects AI service calls with the shared server-side token.

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
   uvicorn main:app --env-file .env --host 127.0.0.1 --port 8001
   ```

5. In a second terminal, set `AI_SERVICE_URL=http://127.0.0.1:8001` in `server/.env` and start the existing API:

   ```powershell
   cd server
   npm install
   npm start
   ```

6. Check `http://127.0.0.1:8001/health` and `http://localhost:5000/api/ai/health`.

## 2. Database setup

Run both scripts in the Supabase SQL Editor:

1. `server/ai-schema.sql` creates the private-by-default tables used by the group capstone generator and selected title.
2. `server/ai-user-usage.sql` creates the private one-time AI usage ledger and service-role-only database functions. It enforces one successful CV-based generation of exactly three title options per user, then persistently disables that user's AI chat and generation endpoints.

Do not skip `ai-user-usage.sql`: the API returns a configuration error until the usage table and RPC functions exist. The three returned title options are stored so the user can still view them after refreshing. The original uploaded CV and extracted profile are not persisted by the Dashboard chat workflow.

## 3. One-time CV workflow

The student uploads one PDF, DOCX, or TXT CV (maximum 10 MB). The API takes the course from the authenticated Supabase user record, asks Ollama to extract course-aware skills, then requests exactly three distinct title candidates. Only after all three options are successfully generated and saved does the database switch the user to `disabled`. The Dashboard disables chat and uploads, and its status endpoint restores the saved options after a page refresh. Failed analysis/generation releases the temporary claim and allows a retry.

Supported programs: BSIT, BSCS, BS Tourism Management, BSCpE, BSBA, BSAIS, BSHM, and BACOMM.

## 4. Group capstone API flow

- `POST /api/ai/groups/:groupId/analyze-member?filename=resume.pdf` with an `application/octet-stream` body. The body is the original file bytes.
- `POST /api/ai/groups/:groupId/generate-titles` generates three title options from the group's saved profiles.
- `POST /api/ai/groups/:groupId/select-title` with JSON `{ "title": { ...one returned title object... } }` saves the group's selected title.
- `GET /api/ai/groups/:groupId/profiles` returns the saved extracted profiles to group members.
- `GET /api/ai/groups/:groupId/selected-title` returns the selected title, if one exists.

Allowed formats are PDF, DOCX, and TXT, up to 10 MB and 30 PDF pages. Scanned PDFs are rejected with a clear message in this first version; OCR can be added after the basic flow works.

## Important deployment note

This is a local-development setup. Ollama and this service must not be exposed directly to the public internet. A Vercel-hosted Express function cannot reach Ollama on your personal computer unless the AI service is deployed on a securely reachable machine with authentication and TLS. Do not deploy this configuration unchanged.

The existing application authenticates API requests using the `x-user-id` header. That is not secure authentication for a public deployment by itself. Before production, replace it with verified Supabase Auth access tokens and enforce membership checks server-side. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.


## Course-aware CV analysis

The authenticated CV upload endpoint passes the signed-in student's registered course from the Supabase user record to FastAPI as a multipart form field. The analyzer extracts general CV skills plus program-relevant skills and a brief program relevance summary. It supports BSIT, BSCS, BS Tourism Management, BSCpE, BSBA, BSAIS, BSHM, and BACOMM. Unknown course values use a cross-disciplinary fallback rather than forcing an IT-only response.

The Dashboard displays the student's registered program, extracted skills, tools, interests, and program relevance in JUAN-AI, then automatically requests one title suited to that course. The uploaded CV and extracted profile used by this Dashboard chat remain in browser state; this feature does not persist them to Supabase. Students should avoid uploading unnecessary sensitive personal information.
