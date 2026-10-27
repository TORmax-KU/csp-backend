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
