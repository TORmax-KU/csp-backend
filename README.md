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

## Active source imports

Bangkok e-GP, EGAT, IEAT and GISTDA run at startup and every five minutes.
The direct national e-GP search importer has been removed. Its old
`GPROC_INGESTION_ENABLED` and `GPROC_ANNOUNCEMENT_TOKEN` settings are unused.
Use `INGESTION_ENABLED=false` to disable all automatic imports, or each source's
`BANGKOK_INGESTION_ENABLED`, `EGAT_INGESTION_ENABLED`, `IEAT_INGESTION_ENABLED`, or
`GISTDA_INGESTION_ENABLED` flag independently. Overlapping runs of the same
source are skipped. The existing admin `/ingestion/egp` route runs Bangkok.

The public feed currently accepts only verified Bangkok software/IT e-bidding
projects with complete analysis and future deadlines. Importing a listing does
not by itself establish its deadline or verify its TOR. New source candidates
must pass document and eligibility checks before publication.

## Public data rules

- User profiles are private: `GET /api/users` requires an administrator;
  `GET /api/users/:id` requires the account owner or an administrator. Anonymous
  requests return 401; cross-account requests return 403. Invalid IDs return
  404 for authorized readers. Public project responses omit publisher email.
- Exact (`datetime`) deadlines close at their specified instant. Date-only or
  unknown-precision deadlines stay listed through their Bangkok calendar date;
  the UI displays a date rather than an invented time. This does not confirm
  that submissions remain accepted throughout that date.

- Default API search includes only public, verified technology projects from supported sources
  with a future bid deadline, source status `open`, and a verified TOR document.
- Closed, awarded, cancelled, draft and expired projects cannot be brought back
  by changing search parameters. Expiry is checked at request time.
- Source and document checks must be within the last 24 hours. This prevents
  indefinitely presenting stale data as current; it is not a guarantee against
  a source update between syncs.
- `GET /api/projects?availability=all` combines eligible future-deadline and
  unknown-deadline listings. The website uses this mode by default so missing
  deadlines do not silently hide search matches. Omitting `availability` retains
  the API's existing `open` default. `availability=unknown` shows only unknown
  deadlines; `availability=open` shows only eligible future deadlines.
  All modes preserve source, TOR verification and terminal-status exclusions.
  Date filters in `all` mode exclude unknown deadlines.
  Text search matches a literal phrase (case-insensitive), not translation or
  synonyms. No matches returns HTTP 200 with `projects: []` and `total: 0`;
  malformed filters return HTTP 400.
- Unknown deadlines carry an explicit warning in cards and details.
  They are never described as open indefinitely. Procurement start, announcement,
  document sale end and final submission deadline are distinct database fields.
- `deadlineYear=2569` (or `2026`) and `deadlineFrom`/`deadlineTo=YYYY-MM-DD`
  filter final submission dates using Bangkok calendar boundaries. Sorting:
  `deadline` (default), `newest`, or `budget`. Agency, method and budget filters
  combine with text search and pagination.
- IT hardware and system maintenance are included; paper, stationery and printer
  consumables are excluded by the technology classifier. Keyword classification
  still needs source review for ambiguous procurement titles.
- The live home page and TOR detail pages use database records only. Legacy
  demo IDs return the not-found view. The demo data patching command has been
  removed; never fabricate deadlines or verification metadata to populate results.
- `node scripts/audit-demo-data.js` (with `MONGO_URI` configured) performs a
  read-only check for the retired demo script's date fingerprints. Matches are
  candidates for source review, not proof that a record should be deleted.

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

Automatic analysis can be disabled per project with `analysisAutoEligible=false`.
The `skipped` state records deliberately excluded jobs, with an `analysisSkipReason`.
New projects default to automatic eligibility. The worker skips known expired,
awarded, cancelled, closed, or draft bids before loading documents or calling AI;
an unknown deadline still requires extraction. Listing refreshes cannot re-enable
an excluded backlog record. An explicit admin retry or
`node scripts/repair-tor-analysis.js --apply --reanalyze PROJECT_ID` re-enables it,
while deadline/status checks still apply.

To prepare a limited batch with Vertex disabled, run
`node scripts/select-recent-analysis.js --limit 20 --plan tmp/batch-UNIQUE_NAME.json`.
Review that snapshot, then add `--apply` with the same `--plan` path. The snapshot
preserves prior queue fields and exact selected IDs. Completed output is retained;
only eligible selected records are queued. Keep the backend stopped during the
preview/apply sequence; use a one-off Compose container with
`-e VERTEX_AI_ENABLED=false` if its normal environment enables AI. See `lastest.md`
for the batch already applied to this local database.

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

Bangkok document resolution falls back to attachment filenames when the source
omits announcement type labels. Winner/cancellation filenames cannot qualify as
TOR documents. Official detail statuses C01 (contract/PO prepared), C04 (work
delivered), and S5 (cancelled) exclude those records from open opportunities.
The local `bangkok-documents` Postman simulation and
`scripts/test-bangkok-documents-simulation.js` exercise these mappings and the
document resolver over HTTP without paid AI calls.

Limits: 5 attachments, 15 MiB per download, 20 MiB combined, 30-second source request
timeout, 120-second AI timeout. Oversize sources fail rather than silently truncate.
No automatic email delivery is included. Match is technical skill coverage, not
procurement eligibility or a guarantee of suitability. The frontend can consume the
summary and match endpoints; this change implements the backend pipeline.

Run `npm test` for source, validation, worker and percentage regression checks.

Official setup references: [Google Gen AI SDK](https://github.com/googleapis/js-genai)
and [Vertex AI quickstart](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart).


### National discovery providers

Tero and GovSpending run on startup and every five minutes. Both apply a rolling
**two calendar month publication cutoff in Asia/Bangkok**, including the cutoff
and allowing future publication dates. Existing historical records are retained.

Configure `TERO_API_KEY` and `GOVSPENDING_API_KEY` locally. For local testing only,
`TERO_ALLOW_PUBLIC_DEV_KEY=true` retrieves the development key explicitly published
in Tero's docs; production needs a dedicated provider key. The OpenD profile key
belongs in `GOVSPENDING_API_KEY`. Never put keys into source URLs or commit `.env`.
Individual flags are `TERO_INGESTION_ENABLED` and `GOVSPENDING_INGESTION_ENABLED`.

Tero supplies document archives. GovSpending supplies metadata/contracts and
resolves candidate documents through Tero by national project ID. Contract dates
are never submission deadlines. Records from both providers merge on national
identity. Missing or ambiguous PDF evidence stays off the public feed. Read
`docs/procurement-source-evaluation.md` for live findings and coverage limits.

With Vertex enabled and ADC mounted, the worker runs automatically, prioritizes
newer publication dates, skips known terminal/expired bids, and retries rate limits.
Monitor it with `docker compose exec -T backend node scripts/report-national-ingestion.js`.
The recurring run continues while Docker is running. The Postman simulation is
`postman/simulations/national-procurement.sim.yaml`; its companion context file
contains the local verification commands.
