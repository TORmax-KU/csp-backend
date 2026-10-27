# Vertex TOR extraction

## Start from the repository root on Windows

In `csp-backend/.env`, keep your existing MongoDB/OAuth settings and set:

```dotenv
VERTEX_AI_ENABLED=true
GOOGLE_CLOUD_PROJECT=tormax-vertex
GOOGLE_CLOUD_LOCATION=global
VERTEX_MODEL=gemini-3.5-flash
```

The existing local ADC file was successfully tested on 2026-10-26. If it is
missing or revoked, first run `gcloud auth application-default login` using an
account with access to this Google Cloud project's Vertex API and billing.

```powershell
$env:GOOGLE_ADC_HOST_PATH = "$env:APPDATA\gcloud\application_default_credentials.json"
docker compose -f docker-compose.yaml -f docker-compose.vertex.yaml up -d --build --renew-anon-volumes
docker compose -f docker-compose.yaml -f docker-compose.vertex.yaml logs -f backend
```

The override mounts the host credential file read-only and sets the container's
`GOOGLE_APPLICATION_CREDENTIALS`. Plain root `docker compose up` does not mount
ADC. Set `GOOGLE_ADC_HOST_PATH` again in each new PowerShell session, or store its
path (not credential contents) in a root `.env` used by Compose. The first upgrade
uses `--renew-anon-volumes` because old dependency volumes may lack `pdf-parse`.
It does not replace the named MongoDB data volume. Later starts can omit this flag.

After MongoDB connects, the enabled worker validates config and ADC, releases
held **pending** TORs, and immediately attempts one job. It checks every 10 seconds,
with one job in flight per backend process. MongoDB leases prevent two workers
claiming the same job. Run one enabled worker against the shared database to keep
usage predictable. No manual requeue command is needed for the reset TORs.

With `VERTEX_AI_ENABLED=false`, no worker starts and held records stay held.
To disable an already-running worker, change `.env` and recreate the backend;
editing `.env` alone does not update a running container's environment.

## Results and validation

The v3 extractor reads original PDFs (including related invitation announcements)
and saves budget in THB, publication date, final bid submission deadline, Thai TOR
summary, mandatory skills and page/quote/document evidence. It leaves the title
unchanged. Budget and dates from listing scrapers cannot overwrite AI-owned values.

Dates use the printed year and an explicit BE/CE calendar. Code converts BE by
subtracting 543, validates actual calendar dates and chronology, and checks quoted
year/month/day/time. Date-only deadlines never acquire an invented time. Amounts
need a quoted budget label and matching number; reference prices are separate.

The model gets one correction attempt for invalid metadata citations. Remaining
invalid/conflicting values stay null and are marked `ambiguous`; absent values
stay null with `not_found` and a reason. PDF page bounds are checked. Quotes are
also compared with text-layer content when available; scanned PDFs rely on the
model's visual reading and still require human verification of the linked page.
These checks reduce errors, not a guarantee that every extraction is correct.

`completed` means available documents were analyzed, not that every field was
found. `awaiting_documents` means missing/inadequate TOR scope; useful supported
metadata from an announcement can still be saved. `needs_review` means ambiguous
or invalid output. Missing fields do not imply bidding is open. Terminal award,
cancellation and draft states are preserved.

Temporary failures (including 429) retry up to three times with backoff. ADC
failures pause before releasing holds. Vertex 401/403/404 pauses the worker after
recording that job's failure; fix credentials/model access and restart, then an
admin can retry the failed job through the existing analysis endpoint. Unavailable
official PDFs, blocked portals, more than five attachments, and unsupported hosts
cannot be solved by prompting and remain awaiting documents/review.

## Checks performed

On 2026-10-26, live `gemini-3.5-flash` extracted the scanned PBIS sample's budget
2,330,000 THB, publication 2026-09-09 and deadline 2026-09-15 16:00 Asia/Bangkok,
plus summary/skills with citations. The read-only smoke command saves its report
under ignored `tmp/vertex-extraction-check.json` and never writes to MongoDB:

```powershell
docker compose -f docker-compose.yaml -f docker-compose.vertex.yaml run --rm --no-deps backend node scripts/check-vertex-extraction.js --source https://egp2.bangkok.go.th/project-detail/0d1e0f7d-eabc-4840-b632-043635d17454
```

See `postman/simulations/vertex-extraction.context.md` for the SDK HTTP simulation
and isolated local MongoDB persistence check. It does not test model accuracy.

Credential setup: https://docs.cloud.google.com/docs/authentication/application-default-credentials
Structured output: https://docs.cloud.google.com/vertex-ai/generative-ai/docs/samples/generativeaionvertexai-gemini-controlled-generation-response-schema-3
