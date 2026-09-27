# clone csp-backend
# clone frontend repo
# create .env in csp-backend folder
# docker compose up -d

## Vertex AI TOR analysis

Uses `@google/genai` with Vertex AI and Application Default Credentials (ADC).
Requires Node.js 22+ (the Docker image already uses Node 22).

1. Choose a Google Cloud project with billing enabled, enable the Vertex AI API,
   and grant the runtime identity `roles/aiplatform.user`. For local development,
   install Google Cloud CLI and run:

   ```powershell
   gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID
   gcloud auth application-default login
   gcloud auth application-default set-quota-project YOUR_PROJECT_ID
   ```

2. Add these values to backend `.env` (do not commit credentials):

   ```dotenv
   VERTEX_AI_ENABLED=true
   GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
   GOOGLE_CLOUD_LOCATION=global
   VERTEX_MODEL=YOUR_AVAILABLE_GEMINI_MODEL_ID
   ```

   Pick a Gemini model supporting PDF input and structured output in your project.
   Vertex API calls incur usage charges. Leave `VERTEX_AI_ENABLED=false` until ready.

3. For the root Docker Compose stack, mount local ADC read-only using the supplied
   override, from the workspace root:

   ```powershell
   $env:GOOGLE_ADC_HOST_PATH = "$env:APPDATA\gcloud\application_default_credentials.json"
   docker compose -f docker-compose.yaml -f docker-compose.vertex.yaml up -d --build --renew-anon-volumes backend
   ```

   For local Node execution, `npm install` and `npm run dev` use your local ADC.
   Do not set a Docker-only `GOOGLE_APPLICATION_CREDENTIALS` path when running locally.
   On Google Cloud use an attached service identity instead of downloading keys.

4. New projects default to `analysisStatus=pending`; a background worker claims one
   project every 10 seconds. Existing scraper updates preserve completed analysis.
   To explicitly queue existing projects that predate this feature:

   ```powershell
   docker compose exec -T backend node scripts/queue-tor-analysis.js
   ```

   Transient 429/5xx/timeouts get at most 3 additional scheduled retries with
   increasing delays (about 1, 2, 4 minutes plus jitter). Admins can
   retry with authenticated `POST /api/projects/:id/analyze`. HTTP 202 means queued,
   not completed. A 15-minute lease recovers work after a process crash; a crash
   after a successful AI call but before persistence can cause a repeated call.

### Stored result and matching

- `descriptions`: Thai summary extracted from the actual TOR PDF; original
  `description` remains source metadata.
- `requiredSkills`: existing Skill ObjectIds (the established field name, not
  `requiredskill`). AI names are normalized and common aliases are resolved.
- `aiAnalysis`: mandatory names, unknown `unmappedSkillNames`, and document URLs.
- `analysisStatus`, `analysisError`, `analyzedAt`, `aiModel`, `aiPromptVersion`:
  processing state and provenance.

`GET /api/projects/:id` exposes the result. Authenticated
`GET /api/projects/:id/match` compares against the signed-in user's `proficiency`:

```json
{"matchPercentage":66.67,"matchedSkillIds":["a","b"],"missingSkillIds":["c"],"requiredCount":3,"reason":null}
```

Percentage = unique matching mandatory skills / unique mandatory skills × 100.
Pending/failed analysis, empty mandatory skills, or unmapped requirements produce
`matchPercentage: null`, never a misleading 100%. New v2 skill names with a TOR
quote, page and document index are normalized and added to the shared catalog.
Names without evidence are not auto-created. Evidence is model-extracted, so review
it against the PDF; it is not a guarantee of semantic correctness.
An admin can also add skills through the existing Skills API;
the match endpoint resolves the current catalog without another AI call. The stored
`requiredSkills` snapshot updates on re-analysis. No user profile is sent to Vertex AI.

### Source support and limits

Statuses distinguish `awaiting_documents` (missing TOR/scope), `needs_review`
(document limits or malformed model output), `retry_pending` (temporary errors),
and `failed` (permanent errors/exhausted retries). No-skills results are valid only
with `aiAnalysis.noMandatorySkillsReason`. `aiAnalysis.skillEvidence` stores quotes
and 1-based PDF page/document indexes in the order of `documentUrls`.

Reclassify old failures without new AI calls:
`node scripts/repair-tor-analysis.js --apply` (omit `--apply` for a preview).
Add `--reanalyze PROJECT_ID` to explicitly queue one project using the v2 prompt;
the running worker will call Vertex AI, incurring normal usage charges.

Bangkok e-GP detail URLs are resolved through `ProjectTors/GetTorInProject`, falling
back to relevant procurement announcements. Direct PDF URLs and HTML pages linking
PDFs are also supported on explicitly configured `TOR_ALLOWED_HOSTS` (exact trusted
public hostnames only; do not add internal services). Redirects are revalidated.
HTML-only TORs, inaccessible documents, non-PDF files, and missing scope fail visibly.
PDFs are sent in memory to Vertex AI and are not stored in MongoDB or on disk.

Limits: 5 attachments, 15 MiB per download, 20 MiB combined, 30-second source request
timeout, 120-second AI timeout. Oversize sources fail rather than silently truncate.
No automatic email delivery is included. Match is technical skill coverage, not
procurement eligibility or a guarantee of suitability. The frontend can consume the
summary and match endpoints; this change implements the backend pipeline.

Run `npm test` for source, validation, worker and percentage regression checks.

Official setup references: [Google Gen AI SDK](https://github.com/googleapis/js-genai)
and [Vertex AI quickstart](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart).
