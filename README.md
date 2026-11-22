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
