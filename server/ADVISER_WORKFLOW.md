# Adviser applications and notification bells

## Apply this update

1. In Supabase > SQL Editor, run the entire [013_notification_application_outcomes.sql](migrations/013_notification_application_outcomes.sql) **after migrations through 012**. It enriches existing student notifications with group, adviser, status and response time. It preserves users, groups, applications, uploads, events and read status. It is safe to rerun. **013 has not been applied to the live database.**
2. For another database, apply missing migrations in numeric order. 010 enables multiple attachments, 011 installs persistent acceptance/expiry events and the 24-hour deadline, and 012 installs adviser submission events and backfills existing unexpired Pending submissions. Never reset the database or rerun sample accounts. Do not rerun older migrations after newer ones.
3. Restart the API with `npm.cmd run server` from Juanfinder. Deploy/restart the frontend and refresh the browser. Development requests now use the existing Vite /api proxy, so a phone or another computer does not accidentally request its own localhost:5000. If the API is hosted separately, set VITE_API_URL to that API origin **at frontend build time** and configure FRONTEND_URL on the API for the frontend origin.
4. Verify the expiration scheduler below. Notifications poll every 5 seconds while the bell is open, every 30 seconds otherwise, and on window focus. No logout/login is needed.

## Resulting workflow

Pending applications appear in the adviser's bell, with group, course, unique member count, original submission time, 24-hour deadline, actual application attachment summary, status, View and Accept. Groups contains accepted assignments only. Dashboard retains its counts and announcement/calendar. View opens the same application for both read and unread notifications; a failed read-status write does not block View or falsely mark it read. Reject remains available inside application details and sends no applicant notification.

Acceptance reuses the existing database transaction: group, application, adviser and member locks protect ownership, finalized status, course, capacity, member assignments and the exact deadline. One accepted group consumes one slot. Repeated or competing requests cannot double-assign it. Terminal events stay in history; Accept is disabled. Submission, acceptance and expiration notifications are database events with unique event keys, rather than frontend placeholders.

Only the session-authenticated API accesses notification RPCs; recipient IDs come from the verified session. Direct anon/authenticated Supabase roles cannot read the table or execute these service RPCs. Application metadata and private signed file URLs are scoped to the selected adviser and application. Application attachments use group_adviser_application_documents and application-requirements paths in the private student-portfolios bucket; they are separate from student portfolio records.

A successful lookup returning zero files displays the no-files message. Failed metadata lookup does not establish zero files. If the upload transaction commits but its follow-up metadata read fails, the submission still succeeds and omits unconfirmed metadata; a later View retrieves committed attachments. Do not resubmit a committed application to retry this lookup. Bell refresh failures preserve loaded notifications and emit only sanitized operation/status diagnostics. An expiry-maintenance failure does not hide existing inbox events. The overlays contain no load-error or Retry controls.

## Live read-only audit - 16 October 2026

The configured Supabase project has the notifications table and the 012 review/inbox routines. The inbox RPC returned two events for an adviser recipient and one for a student recipient; recipient roles matched the event types. The current Pending application already had its adviser submission event. This rules out absent notification records as the cause for those recipients at audit time; it does not verify which API/frontend build a particular browser is running.

The current application had zero application-document metadata rows. Storage contained two application-upload files: one under another applicant's folder, the other under the current applicant's folder but created before the current submission. Neither establishes ownership by the selected application. No files were moved, deleted, or attached speculatively. Two historical notifications no longer referenced a surviving application; their stored messages remain history.

The audit did not perform a live login/submission/acceptance, apply 013, or verify cron execution. Production behavior still requires the migration and updated API/frontend deployment above. Actual user credentials were not used in tests.

## Expiration scheduler

011 attempts to install pg_cron and schedule an every-minute job. Verify in Supabase SQL Editor:

```sql
SELECT extname FROM pg_extension WHERE extname = 'pg_cron';
-- Run the following only if pg_cron is installed:
SELECT jobid, jobname, schedule, command, active FROM cron.job
WHERE jobname = 'juan-finder-expire-adviser-applications';
SELECT status, return_message, start_time FROM cron.job_run_details
WHERE jobid IN (SELECT jobid FROM cron.job
  WHERE jobname = 'juan-finder-expire-adviser-applications')
ORDER BY start_time DESC LIMIT 5;
```

If the extension/job is unavailable, configure an always-running hosting scheduler or Windows Task Scheduler every minute to run `node /absolute/path/to/Juanfinder/server/expire-adviser-applications.js`. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in server/.env or its environment. Keep the service key server-side. Browser polling catches overdue applications when a user returns, but does not replace an unattended scheduler. Database acceptance still checks the exact deadline even between scheduled runs or after waiting for locks.

## Local verification

- `npm.cmd test`: isolated migrated PostgreSQL via PGlite, actual Express routes, separate bearer sessions, authorization, attachments, event deduplication, capacity, expiration, outcome details and read persistence. Supabase transport and Storage are simulated.
- `npm.cmd run test:postgres`: disposable localhost PostgreSQL with independent sessions verifies deadline/lock races and last-slot competition. The Windows sandbox initially blocked OS identity lookup; the same tests passed outside the sandbox. No live database connection is used.
- `npm.cmd run test:ui`: desktop/mobile Chrome checks notification presentation, VIEW/ACCEPT, terminal states, previews/downloads, failures, polling and refresh. These tests mock API responses.
- For the complete browser flow with actual Express routes and migrated SQL, start Vite on port 5178, then run:

```powershell
$env:WORKFLOW_BROWSER_URL = 'http://127.0.0.1:5178'
node --test --test-name-pattern='two browser accounts' server/adviser-workflow.test.js
Remove-Item Env:WORKFLOW_BROWSER_URL
```

This integration test uses separate student/adviser browser contexts and real API/SQL responses, with in-memory Supabase transport/Storage. It submits three PDFs, waits for adviser polling, renders an uploaded PDF, opens a previously read application, accepts it, verifies the assigned group/one consumed slot, waits for student polling and verifies read status after refresh. It does not touch live users or uploads.

- `npm.cmd run build` and `npm.cmd run lint` validate frontend types, production build and lint.

The file preview renders PDFs inside the app. Word files provide text preview plus original download. Application uploads allow up to five PDF/DOC/DOCX files totaling 10 MB. Hosting must accept JSON requests up to 15 MB for base64 uploads.
