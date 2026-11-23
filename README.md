# TORmax backend

The API and background workers for TORmax, built with Node.js, Express and
MongoDB. It:

- imports Thai government IT procurement listings every five minutes;
- optionally reads TOR PDFs with Google Vertex AI to extract summaries,
  deadlines and required skills;
- serves the search feed, accounts, bookmarks, direct job postings and admin
  moderation;
- matches vendors to TORs and sends in-app and email alerts.

> **Want to run the whole website?** Follow the
> [main repository README](https://github.com/TORmax-KU/TORmax#readme). It starts the
> website, this API and MongoDB together with one Docker command. This page
> covers running and configuring the backend on its own.

## Run the backend

### What you need

- [Node.js 22 or newer](https://nodejs.org/)
- A MongoDB database: either a local
  [MongoDB Community Server](https://www.mongodb.com/try/download/community), a
  database-only Docker container
  (`docker run -d --name tormax-mongo -p 27017:27017 mongo:8.0`), or a
  [MongoDB Atlas](https://www.mongodb.com/atlas) connection string

### Steps

```powershell
cd csp-backend
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }   # macOS/Linux: [ -f .env ] || cp .env.example .env
```

Edit `.env`. The example is set up for Docker, so change `MONGO_URI` to point at
your own database:

```dotenv
MONGO_URI=mongodb://127.0.0.1:27017/fullstack_db
SESSION_SECRET=<paste a random value>
```

To generate the secret, run
`node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.

Then start the backend:

```bash
npm run dev     # restarts automatically when you edit files
```

The API runs at **http://localhost:5001**. When MongoDB connects, the source
imports start straight away and repeat every five minutes. To check that it's
working, open http://localhost:5001/api/projects in a browser: you should get
JSON back.

To run the website against this backend, see the
[frontend README](https://github.com/Karczel/Untitled-Collab-Project-Frontend#readme).

### Running inside the root Docker stack

When you start the backend from the main repository's `docker-compose.yaml`:

- It still reads this folder's `.env`, but Compose forces `PORT=5000` (published
  on host port 5001) and points `MONGO_URI` at the Compose `mongo` service. You
  don't need to edit those two values.
- The container runs nodemon with polling, so code edits reload reliably on
  Windows.
- Run scripts inside the container like this:
  `docker compose exec -T backend node scripts/<name>.js`.
- After pulling changes that add npm packages, refresh the container's
  `node_modules` with `docker compose up -d --build --renew-anon-volumes backend`.

## Configuration

All settings live in `.env`. Start from `.env.example`, which explains each one.
Never commit `.env` or credential files. The settings you're most likely to
touch:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5001` | API port when running with Node |
| `MONGO_URI` | `mongodb://mongo:27017/fullstack_db` | Database. Use `127.0.0.1` instead of `mongo` outside Docker |
| `FRONTEND_URL` | `http://localhost:3000` | Website address, used for CORS, redirects and email links |
| `SESSION_SECRET` | *(blank)* | Signs login sessions. If blank, sessions reset when the backend restarts. Required in production |
| `NODE_ENV` | *(blank)* | Set to `production` when hosted: makes the login cookie HTTPS-only and trusts the host's proxy. See [hosting](https://github.com/TORmax-KU/TORmax#hosting-vercel--render) |
| `INGESTION_ENABLED` | `true` | Set to `false` to stop all source imports ([details](docs/data-sources.md)) |
| `MATCHING_ENABLED` | `true` | Vendor matching sweep ([details](docs/matching-and-alerts.md)) |
| `VERTEX_AI_ENABLED` | `false` | AI analysis of TOR PDFs ([details](docs/vertex-ai.md)) |
| `EMAIL_ALERTS_ENABLED` | `false` | Email alerts over SMTP ([details](docs/matching-and-alerts.md#email-smtp)) |

### Optional features

Without any extra credentials, these work: browsing, email/password
registration and login, profiles, bookmarks and direct job postings. Passwords
are stored as bcrypt hashes and are never returned by the API.

The features below need your own credentials:

- **Google login.** Create an OAuth client in Google Cloud Console and register
  `http://localhost:5001/auth/google/callback` as an authorized redirect URI.
  Then fill in `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and
  `GOOGLE_CALLBACK_URL`.
- **Government TORs in the public feed.** Imported TORs only appear after AI
  analysis completes, so a fresh database shows none until you set up Vertex AI.
  See [docs/vertex-ai.md](docs/vertex-ai.md). Another option is to connect to an
  authorized shared database that already has analyzed records.
- **Tero and GovSpending sources.** These need API keys. See
  [docs/data-sources.md](docs/data-sources.md).
- **Email alerts.** Need an SMTP server. See
  [docs/matching-and-alerts.md](docs/matching-and-alerts.md#email-smtp).
- **Scraper alerts to Slack/Discord.** Set `INGESTION_ALERT_WEBHOOK_URL`.

## Tests

```bash
npm test                 # unit and route tests
npm run test:coverage    # same, with an lcov coverage report
```

MongoDB integration tests are skipped unless `TEST_MONGO_URI` points to a
database they can use, for example `mongodb://127.0.0.1:27017`. They create
and clean up their own test data.

The Postman simulations in `postman/simulations/` test source and document
handling over HTTP without paid AI calls.

## Useful scripts

Run these from `csp-backend`, or inside Docker with
`docker compose exec -T backend node scripts/<name>.js`.

| Script | What it does |
| --- | --- |
| `create-admin.js --email you@example.com` | Makes an account an admin ([details](docs/admin.md)) |
| `report-ingestion-health.js [days]` | Shows success rates for each source |
| `report-national-ingestion.js` | Shows Tero/GovSpending import and analysis progress |
| `queue-tor-analysis.js` | Queues existing projects for AI analysis |
| `repair-tor-analysis.js` | Previews or repairs failed analyses (`--apply`, `--reanalyze ID`) |
| `audit-demo-data.js` | Read-only check for leftover demo data |
| `remove-retired-procurement.js` | Previews or removes data from the retired importer (`--apply`) |

## Project layout

```text
src/
  server.js      entry point: Express app, MongoDB connection, background jobs
  config/        session and Passport (Google login) setup
  routes/        HTTP endpoints
  models/        Mongoose schemas
  services/      scrapers, ingestion scheduler, AI worker, matching, email
  middleware/    auth and request guards
scripts/         one-off admin and maintenance commands
test/            node:test suites
postman/         HTTP simulations
docs/            detailed documentation (below)
```

## Detailed documentation

- [Data sources and ingestion](docs/data-sources.md): which sites are imported,
  flags, scraper health
- [Public feed and data rules](docs/public-feed.md): what is shown publicly,
  deadlines, drafts, search parameters
- [Vertex AI TOR analysis](docs/vertex-ai.md): setup, statuses, limits, skill
  matching
- [Vendor matching and alerts](docs/matching-and-alerts.md): notifications and
  email
- [Admin console and moderation](docs/admin.md): admin setup, reports, removal,
  endpoints

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

## Security scan (OWASP ZAP DAST)

Run before each release against the local Docker stack, never against production.
With the stack up (`docker compose up -d --build` from the root), run from `csp-backend`:

```powershell
.\security\zap\run-zap.ps1
```

The script runs ZAP's API scan (`zap-api-scan.py`) on the public endpoints listed in
`security/zap/openapi-public.yaml`. It does a passive check plus an active attack
scan, which sends real login/register requests, so it may leave test data in your local database.
The report is saved to `security/zap/reports/zap-backend-report.html`, which is gitignored.
