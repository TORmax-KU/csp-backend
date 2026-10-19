# TORmax backend

## Run with your own MongoDB (no Docker required)

Requires Node.js 22+ and a running MongoDB instance.

```powershell
cd csp-backend
npm ci
Copy-Item .env.example .env
npm run dev
```

Copy the example only if you do not already have `.env`. The default connection is
`mongodb://127.0.0.1:27017/fullstack_db`; change `MONGO_URI` to your own MongoDB URI.
The backend defaults to port 5001. Browsing does not require Google OAuth or Vertex
credentials. Google login is unavailable until its credentials are configured.
Set `SESSION_SECRET` for persistent sessions; it is mandatory in production.

In another terminal:

```powershell
cd TORment-Frontend
npm ci
Copy-Item .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. Each teammate connects to their own MongoDB;
pulling Git does not copy another person's database. The source check starts
automatically after MongoDB connects and repeats every five minutes, in either
local Node or Docker. It runs only while the backend is running. Concurrent ticks
in a single backend process are skipped; use one ingestion-enabled backend per DB.

For the root Docker stack, run `docker compose up -d --build`. Compose overrides
the Mongo host to `mongo` and maps backend port 5000 to host port 5001.

## National e-GP migration: source access is currently blocked

The old Bangkok e-GP scheduler is retired and cannot repopulate old records.
On 2026-10-05 the national e-GP public announcement API returned
`{"validateCfTurnTile":false}`. The new client detects this as
`SOURCE_ACCESS_REQUIRED`, logs a failed attempt, and shows an explicit message
on the website. It does **not** treat this response as a successful empty import.
No CAPTCHA bypass, token generation or synthetic project seeding is implemented.

**Automatic import of real projects is not complete.** Authorized source access
or representative official exports are still needed to verify detail fields,
bid-closing timestamps, project status and original TOR links. Even if search
access becomes available, search-only rows are held back with
`SOURCE_DETAILS_REQUIRED`; they cannot establish that a project is open or has a
working TOR. A short-lived announcement token alone is not a permanent integration.
`GPROC_ANNOUNCEMENT_TOKEN` can provide legitimately obtained access for further
integration verification; never commit it. Set `GPROC_INGESTION_ENABLED=false`
to disable the automatic source checks.

The scheduler currently probes the software search for the current Thai fiscal
year. Full keyword coverage, pagination, detail/document ingestion and status
refresh must be completed after access is available. Do not claim the scraper is
production-ready or promise teammates their database will populate yet.

## Public data rules

- Default search includes only public, verified national e-GP technology projects
  with a future bid deadline, source status `open`, and a verified TOR document.
- Closed, awarded, cancelled, draft and expired projects cannot be brought back
  by changing search parameters. Expiry is checked at request time.
- Source and document checks must be within the last 24 hours. This prevents
  indefinitely presenting stale data as current; it is not a guarantee against
  a source update between syncs.
- Unknown deadlines appear only in the separate `availability=unknown` view.
  They are never described as open indefinitely. Procurement start, announcement,
  document sale end and final submission deadline are distinct database fields.
- `deadlineYear=2569` (or `2026`) and `deadlineFrom`/`deadlineTo=YYYY-MM-DD`
  filter final submission dates using Bangkok calendar boundaries. Sorting:
  `deadline` (default), `newest`, or `budget`. Agency, method and budget filters
  combine with text search and pagination.
- IT hardware and system maintenance are included; paper, stationery and printer
  consumables are excluded by the technology classifier. Keyword classification
  still needs source review for ambiguous procurement titles.
- The live home page does not use demo listings or invented statistics. Legacy
  demo detail pages carry an explicit demo label.

Cleanup for a teammate who still has the retired source:

```powershell
node scripts/remove-retired-procurement.js
node scripts/remove-retired-procurement.js --apply
```

The first command previews the count. The second deletes only `bangkok-egp`
projects without a publisher and their dependent matches/notifications. Users,
profiles, skills and other sources are not deleted. Run after updating/restarting
the backend so the old importer cannot race the cleanup.

The `projects` schema now stores procurement dates, method, reference price,
status, verified documents, qualifications, deliverables, source skill names,
contact details and submission location. Fields missing from the source remain
missing in the UI; AI summaries are separately labeled and cannot supply dates.

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
