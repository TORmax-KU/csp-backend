# Procurement source evaluation — 28 October 2026

## Tero procurement

Documentation: https://run-procurement.terodigital.com/api-docs/procurement

- Live `GET /api/announcements` returned HTTP 200 using the documentation's explicitly published development test key. No private key was needed or committed. Production use needs a dedicated key from the service owner; the documentation says to retire its development key for production.
- The test filtered `keyword=ซอฟต์แวร์`, `status=ระหว่างดำเนินการ`, `limit=3`, `offset=0`: `meta.total` was 108. This is the source's listing/status count, not a count of verified open bids. API defaults are broader than the website's watchlist/ministry filters.
- Response includes stable `project_id`, title, agency/ministry, `announce_date`, budget, reference price, procurement method, source status and `doc_reference`. It has no explicit bid-closing timestamp. Pagination is `limit`/`offset`, with a documented maximum limit of 500.
- Authentication header is `X-API-Key`. Never hard-code a key in tracked configuration or display request headers in logs.
- The document-column “เปิด” link is the original government HTML search/detail page, not a PDF. The separate Tero `GET /announcements/gprocurement/PROJECT_ID/document` route returned a real ZIP (HTTP 200, 1,579,215 bytes) for project `69109156238`.
- That archive contained 15 entries including an actual TOR, official invitation, tender documents, standard forms and an XLSX. The official invitation was visually checked: publication 26 October 2026, final submission 12 November 2026 at 16:00 Asia/Bangkok. The TOR's first page states an allocated budget of 1,100,000 baht. The invitation's reference price alone must not be substituted for approved budget.
- This is an independently operated aggregation service, not an official government domain. Preserve its original government references and verify document/project identity, terminal statuses and dates before publication. Current success does not establish completeness, SLA or future availability.
- Integrated into startup/five-minute ingestion. The rolling cutoff is two calendar months in Bangkok (28 August 2026 on this review date), using publication rather than insertion dates, with no upper date bound. Bounded in-memory ZIP selection includes invitation, actual TOR and tender PDF; standard forms/XLSX are excluded. The public e-bidding feed now accepts this provider after the same completed evidence/future-deadline checks as Bangkok.

## GovSpending / DGA

Documentation: https://govspendingdelta.data.go.th/doc-api

- Documentation and its public service-definition endpoint returned HTTP 200. The page loads its definitions from `https://api-govspending.data.go.th/api/get/api/list`.
- Documented procurement endpoint: `GET https://opend.data.go.th/govspending/service/egp-contract`. Required query parameters are `api-key` and fiscal `year`. Optional filters include keyword, department code, winner tax ID, budget bounds, offset and limit (maximum 1,000).
- An unauthenticated request returned HTTP 401. The user's existing local key was found under the retired importer variable, successfully authenticated with HTTP 200, and copied locally to `GOVSPENDING_API_KEY` without exposing its value.
- The documented response contains project identity, agency, announcement date, project budget, median price, procurement method/status, contract dates, winning suppliers and contract amounts. It does not document a TOR download URL or bid submission deadline. Contract completion dates are not bid deadlines.
- Inference from that contract: useful for cross-checking procurement metadata/spending history, but insufficient by itself to publish verified open TOR opportunities.
- A key can be supplied locally as `GOVSPENDING_API_KEY` in the ignored backend `.env`. The local diagnostic `tmp/check-govspending-api.cjs` at workspace root reads it without printing it, avoids redirects, and suppresses any echoed key from response output. Do not copy its raw response to logs: the documentation's example response echoes request credentials.

## Removed source and active runtime

The direct national search importer and its homepage access-verification notice were removed. Official government document hosts remain allowed because other working sources link to official documents there. Historical ingestion logs were retained; no projects were deleted.

The six configured importers are Bangkok, EGAT, IEAT, GISTDA, Tero and GovSpending. Each has independent startup/five-minute scheduling and overlapping-run protection. `INGESTION_ENABLED` replaces the retired national source flag as the global switch. The admin `/ingestion/egp` route now starts Bangkok.


## Integration and live run

- GovSpending uses fiscal years intersecting the two-month window (2569 and 2570 at review time). Its actual dates can be Thai abbreviated Buddhist dates such as `28 ส.ค. 69`; missing dates are excluded. Unavailable future fiscal years can return HTTP 500, so they are queried only when the rolling calendar reaches them. Software/system/web keywords are scanned; broader hardware discovery comes from Tero. The first complete authenticated scan yielded seven recent records: two new contracted records and five matches to Tero records. Known contracts override an ongoing listing label and remain off the open feed. Contract end dates never become bid deadlines.
- National project IDs have a sparse unique index. Cross-provider matches merge provenance without replacing extracted budget/dates/AI fields. Existing projects were retained. Source URLs never contain API credentials; GovSpending request echoes are not persisted.
- Tero initially inserted 938 candidates. Medical scanner and electrical distribution false positives are excluded from IT eligibility; historic imports are retained as skipped. Newer source publications are prioritized. A strict single-day invitation deadline preflight skips recognized expired bids without a paid model call; unrecognized/scanned cases continue through evidence-based Vertex extraction.
- `tor-pdf-v4-reading-order` uses PDF text positions to reconstruct horizontal reading order for colored inserted dates. Citations still require the complete normalized quote on its exact physical PDF page; wrong numbers/events remain invalid. Invalid skill citations get one correction attempt. Document bytes and archive entry names remain linked in provenance.
- Selected PDFs are capped at five, 15 MiB each and 20 MiB combined, archive expansion at 100 MiB and 200 entries. Provider-controlled paths are never extracted to disk. ZIP URLs with `#file=` identify actual archive entries rather than invented individual download endpoints.
- Completed open documents are re-read after 12 hours; matching SHA-256 hashes renew freshness. Changed PDFs are requeued. Missing/review documents are checked again after 12 hours. Public verification still expires at 24 hours. HTTP 429/5xx and model rate limits use retries; no source listing is considered proof that a bid is open.
- Real paid Vertex analysis produced a fully qualifying graphical-software project `69109160427`: budget 700,000 THB, published 26 October 2026, submission closes 12 November 2026 at 16:00 Asia/Bangkok. Other candidates continue in the background; discovery counts are not verified-open counts.
- Verification: all 76 backend tests passed with the optional MongoDB integration enabled, frontend production build passed, and local Postman HTTP simulation passed. Simulation fixtures cover provider auth, recency, shared identity, contract status, ZIP selection and upstream error responses; live APIs and Vertex were exercised separately.
- During the live run, eight new Tero records had completed all required fields and the live public feed contained nine open projects including the original Bangkok record. Analysis continues asynchronously; this is a point-in-time count, not completion of the entire candidate queue.
