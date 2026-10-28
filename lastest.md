# 2026-10-28 - Two-month national procurement discovery and live Vertex run

- Added Tero Procurement and authenticated GovSpending discovery, using publication dates from two calendar months ago onward (28 August 2026 at this run). Existing historical records are retained.
- Tero ZIP downloads select actual TOR/tender/invitation PDFs with bounded expansion. Matching national project IDs merge provider provenance; known contracts/cancellations and expired invitations are excluded from paid processing/open results.
- Public IT e-bidding results now include the new providers when verified PDF evidence supplies summary, budget, publication date and a future submission deadline. Frontend search labels no longer imply Bangkok-only coverage and cards show provider names.
- Vertex is enabled and running in Docker. PDF reading order and physical-page citation correction improve evidence validation. The new graphical-software project (700,000 THB, closes 12 November 2026 16:00 Bangkok) qualified; the remaining queue continues asynchronously with rate-limit retries.
- Live feed reached nine qualifying open projects (eight new Tero records plus the original Bangkok record); the larger candidate queue is still running.
- Both services were rebuilt/restarted with the existing ADC mount. All 76 backend tests including isolated MongoDB integration, frontend production build and Postman HTTP simulation passed. See backend `docs/procurement-source-evaluation.md` and `scripts/report-national-ingestion.js` for scope and live status.

# Source removal and replacement evaluation — 28 October 2026

- Removed the direct national e-GP search client/poller and its public allowed-source entry. Shared Thai fiscal-year calculation moved to `ProcurementCalendar.js`. The four retained sources (Bangkok, EGAT, IEAT, GISTDA) each have independent startup/five-minute runs and overlap protection. `INGESTION_ENABLED` is the new global switch; legacy `GPROC_*` settings are unused. The existing admin `/ingestion/egp` route now starts the Bangkok importer.
- Deleted the frontend national-source `IngestionNotice` component and removed it from the homepage. Restarted backend and frontend. Live API returned HTTP 200 / one eligible project and listed exactly the four retained sources. New-process logs show no national polling. Browser confirmed the existing card loads with no retired-source warning.
- Tero `run-procurement.terodigital.com` passed live discovery: its documented public-development-key API returned HTTP 200, and one actual software project's document route returned a valid ZIP with TOR and official invitation PDFs. The future deadline and approved budget were visually reviewed. No Tero project was imported or sent to Vertex. A production key, ZIP resolver, provenance/deduplication and expansion of the Bangkok-only feed remain separate integration work.
- GovSpending documentation and public API metadata returned HTTP 200; the documented procurement endpoint returned HTTP 401 without a key. No local `GOVSPENDING_API_KEY` was present. Authenticated data remains unverified. Its documented fields cover procurement/contract history and do not document a TOR URL or bid-closing deadline. See `docs/procurement-source-evaluation.md` for endpoints, findings and limits; do not commit or print keys.
- Validation: 69 backend tests passed, 1 optional Mongo integration test skipped; frontend production build passed. No additional restart is required for the removal. Historical ingestion logs and all projects were preserved.

# Deeper source review — 28 October 2026 (after queue handoff below)

- Scanned insertion ranks 700–791 (a fixed `createdAt`, then `_id` ascending snapshot): 80 Bangkok and 12 IEAT records. Re-fetched the official Bangkok detail/TOR/announcement endpoints; retried 3 detail timeouts successfully. The IEAT invitation URLs returned PDFs, but the listing publication dates were 2023–2025 and these records remain outside the Bangkok-only feed.
- Fixed official metadata handling: missing announcement type labels fall back to filenames; winner/cancellation filenames are excluded from TOR candidates. Detail C01 (`จัดทำสัญญา/ PO แล้ว`) means awarded, C04 (`ส่งงานครบถ้วน`) means closed, and S5 means cancelled. Enrichment and the worker now respect these terminal states rather than treating them as unknown/open.
- Visually reviewed official invitations and verified full document loading for five additional future-deadline candidates: rank 723 / `6ae0b63ffb773330336475e9` closes 29 Oct 12:00; rank 734 / `6ae0b640fb773330336475f4` closes 29 Oct 16:00; rank 735 / `6ae0b640fb773330336475f5` closes 12 Nov 16:00; rank 736 / `6ae0b640fb773330336475f6` closes 2 Nov 12:00; rank 740 / `6ae0b641fb773330336475fa` closes 30 Oct 16:00. All dates are 2026, Asia/Bangkok. The four previously oversize sets now load an invitation plus a scope document under the existing limits. The computer-purchase bundle was missed because its announcement type was null.
- Applied reviewed source statuses to all 80 Bangkok records. Staged only those five IDs as `pending`, `analysisAutoEligible=true`, **`analysisHold=true`** for release by `prepareWorker` on the user's next backend restart. The rest of the backlog remains excluded. No AI budget/date evidence or summaries were invented; these still require extraction. `apply-reviewed-source-scan.js` previews/applies a reviewed snapshot and saves full local backups before writes.
- Verified live API HTTP 200 / one public result, all five pending jobs held, `VERTEX_AI_ENABLED=true`, and ADC mounted. The backend is still running its prior process; the user should now restart **backend only** with both root Compose files. No build or frontend restart is needed. No live Vertex call was made during this scan.
- Local evidence/report: root `tmp/deep-scan-report.md`, root `tmp/deep-scan-summary.json`, invitation PDFs/PNGs in root `tmp/pdfs/deep-scan*`. Applied input: backend `tmp/reviewed-source-scan.snapshot`; before-write backup: backend `tmp/source-review-backup-1793179898290.snapshot`. These are ignored local artifacts. Rank 754 (BMA OSS) was confirmed expired on 20 Oct; rank 755 has blank dates; rank 739's scanned tender bundle had no future deadline confirmed in the inspected pages and was not queued.
- Validation: 67 backend tests passed, 1 optional Mongo integration test skipped. The Postman `bangkok-documents` simulation served seven HTTP requests and passed resolver/status/error assertions. Live source fetches and five document-set downloads also passed. This does not guarantee that every staged project will yield a valid summary and approved budget.

# Analysis queue handoff — 28 October 2026

- Added `skipped`, `analysisAutoEligible` (defaults true for new inserts), and `analysisSkipReason`. The worker excludes records with automatic analysis disabled, including stale processing leases and retries. Known terminal/draft bids and known expired deadlines are skipped before any PDF download or Vertex call; unknown deadlines remain candidates.
- Applied a fixed snapshot of the newest 20 projects by `createdAt` descending, then `_id` descending. Of those 20: 15 are pending, 4 awarded records are skipped, and 1 completed analysis was preserved. All 770 older records have automatic analysis disabled; older pending/retry/stale-processing jobs became skipped. Other prior analysis states and all 3 completed results remain intact.
- Verified database totals: 790 projects; 15 pending; 616 skipped; 147 awaiting documents; 9 needing review; 3 completed. No retry/processing jobs remain. The existing project `6ae0b63ffb773330336475e6` still passes the actual public search query.
- New inserts automatically remain eligible. Scheduled listing refreshes, changed source URLs, enrichment, and worker startup cannot requeue the disabled backlog. Admin analysis requests and `repair-tor-analysis.js --apply --reanalyze ID` explicitly re-enable a selected record; terminal/deadline checks still apply.
- Queue tool: `scripts/select-recent-analysis.js --limit 20 --plan tmp/NEW_PLAN_NAME.json` previews and saves exact IDs and prior queue fields. Add `--apply` with that same plan path to apply it. It refuses to run with Vertex enabled and refuses to overwrite an existing preview. The applied snapshot/backup is `tmp/recent-analysis-plan-2026-10-28.json` (local, ignored by Git).
- Backend was stopped to apply and verify the queue without AI running. Its runtime flag had become enabled before the migration. Leave startup to the user with the Vertex Compose override and an ADC mount. Frontend and Mongo were left running. No live Vertex call was made by the migration or verification.
- Validation: 64 backend tests passed with 1 integration test initially skipped; that integration test then passed separately against an isolated Mongo collection. Frontend production build passed. A read-only database verification confirmed queue isolation and the existing public result.
- Missing TOR PDFs can still prevent the 15 queued candidates from completing. Queued does not mean confirmed open or guaranteed to appear in the feed.

# Backend handoff — 27 October 2026

## Product requirement

Show real, still-open **Bangkok software/IT e-bidding TORs**. A public search result must have a title, positive budget, announcement date, future bid deadline, AI TOR summary, and verified official PDF source. Projects missing a deadline do not appear in the main search. Do not infer missing dates or use a reference price as the budget.

## Current runtime

- `csp-backend/.env` currently has `VERTEX_AI_ENABLED=false`, `EGP_INGEST_PAGES=20`, and `BANGKOK_ENRICH_BATCH=25`. The website works without the Vertex Compose override; existing analyses stay in the configured MongoDB, while pending projects are not newly analyzed.
- Start the **full website from the repository root**, `C:\Users\Adithep\scp_proj`, with `docker compose -f docker-compose.yaml up -d`. The separate `csp-backend/docker-compose.yml` does not start the frontend and uses a different Compose stack. Routine starts do not need `--build`.
- To enable AI analysis deliberately, set `VERTEX_AI_ENABLED=true`, set `GOOGLE_ADC_HOST_PATH` to the local ADC JSON path, and start with both `docker-compose.yaml` and `docker-compose.vertex.yaml`. Recreate the backend when changing its environment. Never commit credentials.
- At the time of this handoff, `docker compose -f docker-compose.yaml ps` showed **no running containers**. Earlier, the base stack was verified with Vertex disabled, no ADC mount, HTTP 200 from `/search-feed`, and one open API result.

## Implementation

- `src/services/RunBangkokEgpIngestion.js` uses the current Thai fiscal year by default. It fetches the 2570 Bangkok e-GP pages; the October 2026 import found 79 software-related records for that year.
- `src/services/BangkokEgpEnrichment.js` verifies real PDF links from the dedicated TOR endpoint and invitation announcements. It no longer treats a project detail page as a verified TOR or repeatedly checks the same unverified record every cycle.
- `src/services/TorSource.js` puts the final invitation before draft TORs, limits the selected PDFs to 20 MiB combined, and passes them to Vertex. `src/services/TorAnalysisWorker.js` starts only when `VERTEX_AI_ENABLED` is exactly `true`; otherwise ingestion and the website still run. New eligible records remain pending until AI is enabled.
- `src/services/ProjectSearch.js` restricts the public search feed to `bangkok-egp`, software classification, and an `e-bidding` procurement method. `ProcurementAvailability.js` requires completed analysis, recent source verification, all required AI fields, and a future deadline.
- National e-GP ingestion currently reports `SOURCE_ACCESS_REQUIRED` because its public search requires Cloudflare verification. This does not stop the Bangkok portal importer.

## Confirmed example and accuracy note

- Bangkok e-GP project `74c54c5d-2019-422e-aea9-6527e4ad48b8`: [official project](https://egp2.bangkok.go.th/project-detail/74c54c5d-2019-422e-aea9-6527e4ad48b8). Database `_id`: `6ae0b63ffb773330336475e6`.
- IT strategy information system project; budget **฿5,560,158**, announced **20 October 2026**, bid deadline **5 November 2026 at 12:00 Asia/Bangkok**. It has an AI TOR summary and was shown as open in the live API and browser on 27 October.
- Two Vertex runs disagreed on the closing time (12:00 versus 16:00) for the scanned invitation. Page 1 was visually checked and clearly says **09:00–12:00**; the stored deadline and evidence quote were corrected to 12:00. Treat future scanned-PDF time extraction as requiring evidence review when results conflict.

## Verification and next work

- Backend tests last passed: **57 passed, 1 Mongo integration test skipped** unless `TEST_MONGO_URI` is set. Frontend production build passed, and the actual browser card displayed all required fields.
- Do not reset the database or replace the confirmed example with guessed fields. When Vertex is re-enabled, monitor pending and review states, especially PDF size limits, scanned date evidence, and 429 retries. Verify any new live result against its official invitation before presenting it as accurate.
