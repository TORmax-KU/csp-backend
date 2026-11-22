# Data sources and ingestion

The backend imports procurement listings automatically. Each source runs once
when the backend connects to MongoDB, then every five minutes while the backend
is running. This works the same with or without Docker.

| Source | ID | Flag | Needs |
| --- | --- | --- | --- |
| Bangkok e-GP | `bangkok-egp` | `BANGKOK_INGESTION_ENABLED` | nothing |
| EGAT | `egat-bidding` | `EGAT_INGESTION_ENABLED` | nothing |
| IEAT | `ieat-procurement` | `IEAT_INGESTION_ENABLED` | nothing |
| GISTDA | `gistda-procurement` | `GISTDA_INGESTION_ENABLED` | nothing |
| Tero Procurement | `tero-procurement` | `TERO_INGESTION_ENABLED` | `TERO_API_KEY` |
| GovSpending | `govspending` | `GOVSPENDING_INGESTION_ENABLED` | `GOVSPENDING_API_KEY` |

- `INGESTION_ENABLED=false` turns off all imports. Setting a source's own flag to
  `false` turns off just that source. A source runs unless its flag is exactly
  `false`, so `.env.example` turns Tero and GovSpending off until you add keys.
- If a run of a source is still going when the next one is due, the new run is
  skipped. Use only one backend with ingestion enabled per database.
- The admin route `/ingestion/egp` starts a Bangkok run on demand.
- The old direct national e-GP importer has been removed. Its
  `GPROC_INGESTION_ENABLED` and `GPROC_ANNOUNCEMENT_TOKEN` settings do nothing.

## What reaches the public feed

Importing a listing does not make it public. A government TOR is listed only if:

- it comes from one of the sources above and is classified as software/IT;
- the source and its TOR PDF were checked within the last 24 hours;
- [AI analysis](vertex-ai.md) has completed and supplied the summary, budget,
  publication date and a future submission deadline.

The full rules are in [public-feed.md](public-feed.md).

## National discovery providers (Tero and GovSpending)

Both providers use a rolling **two-calendar-month publication cutoff in
Asia/Bangkok**. The cutoff date itself counts, and future publication dates are
allowed. Records already in the database are kept.

- Put the keys in `.env` as `TERO_API_KEY` and `GOVSPENDING_API_KEY`. The OpenD
  profile key goes in `GOVSPENDING_API_KEY`. Never put keys in source URLs or
  commit `.env`.
- For local testing only, `TERO_ALLOW_PUBLIC_DEV_KEY=true` uses the development
  key published in Tero's documentation. Production needs its own key.
- Tero supplies document archives. GovSpending supplies metadata and contracts,
  and looks up candidate documents through Tero by national project ID. Records
  from both providers merge on their national project ID.
- Contract dates are never treated as submission deadlines. Records with missing
  or unclear PDF evidence stay off the public feed.
- Monitor progress with `node scripts/report-national-ingestion.js`. With Docker,
  run it as `docker compose exec -T backend node scripts/report-national-ingestion.js`.
- The Postman simulation is
  `postman/simulations/national-procurement.sim.yaml`. Its companion context file
  lists the local verification commands.

## Scraper health and alerts

- **Timeouts (NFR-04):** if a portal doesn't start responding within 30 seconds,
  the run is abandoned and logged as a `SOURCE_TIMEOUT` failure. The next
  five-minute run tries again.
- **Alerts (Open Issue 1):** the backend logs an `[ingestion alert]` when a
  source fails three runs in a row. It does the same when a source returns 0
  listings three runs in a row despite having listings in the past week, which
  usually means the page markup changed. If `INGESTION_ALERT_WEBHOOK_URL` (a
  Slack or Discord incoming webhook) is set, the alert is also posted there. A
  recovery notice follows when the source works again.
- **Success rate (NFR-08, target 95%):** `node scripts/report-ingestion-health.js [days]`
  prints each source's runs, failures, empty runs and success rate. Admins can
  read the same data from `GET /api/admin/ingestion-health?days=7`.
