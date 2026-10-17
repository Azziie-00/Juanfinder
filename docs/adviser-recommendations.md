# Dashboard adviser recommendations

Select **Find my adviser** on the student Dashboard. Llama `llama3.2:1b` compares the student's saved group name/title, description, and selected capstone title (when present) with advisers' saved specialty, skills, and biography. No new model or database migration is required for this feature; the existing adviser workflow migrations must already be installed.

Only active, unexpired advisers in the group's course with available capacity and profile expertise are candidates. Up to 12 profiles are shortlisted by shared topics, ignoring common project boilerplate and recognizing common aliases such as AI/artificial intelligence and IoT/Internet of Things. Llama then ranks up to three matches. Each card includes a reason and a verified excerpt from the adviser's profile. An empty result is valid; an unavailable AI service produces a retry action rather than fabricated recommendations.

This is intentionally conservative for the 1B model: advisers with relevant expertise expressed entirely using other terminology can be missed. Students can still browse all advisers; matching quality depends on specific project descriptions and up-to-date adviser profiles. Generated reasons are suggestions, not acceptance guarantees.

Students must own or be an actual member of a group; pending join requests do not qualify. Groups with an assigned adviser or active application receive a status message. Members and leaders of unfinalized groups may explore matches. **Review & apply** is available to leaders of finalized groups and opens the existing Adviser page with the recommended adviser highlighted, including their requirements. Confirmation and uploads still use the existing application workflow and its database checks.

The backend reads all inputs from saved records, verifies AI IDs and profile excerpts, and rechecks membership, project context, eligibility and capacity after inference. Recommendation requests do not consume or depend on the chat/title-generation quota.

Recommended Groups displays one recommendation at a time in a 360px panel. Next appears when another match is available; Previous lets students return to earlier matches. Refresh starts at the first result. Recommended Adviser stays 180px tall. Long content scrolls internally. JUAN-AI aligns with the calendar on desktop and fills the space between the header and bottom navigation in its dedicated mobile tab.

## Runtime

Restart the Python AI service after updating it so `/recommend-advisers` is available. It uses the existing fixed model `llama3.2:1b`, `AI_SERVICE_URL`, and shared `AI_SERVICE_TOKEN`. Vercel needs a reachable AI service URL; deploying the frontend does not deploy Ollama.

## Validation

- `npm run build`
- `npm run lint`
- `npm test`
- `npm run test:ui -- tests/ui/recommendations.spec.mjs`
- From `ai-service`: `python -B -m unittest test_group_recommendations test_adviser_recommendations` (requires the HTTP client dependency used by the installed Starlette TestClient).
