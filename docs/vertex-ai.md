# Vertex AI TOR analysis

Government TORs need completed AI analysis before they appear in the public
feed. The backend uses `@google/genai` with Vertex AI and Application Default
Credentials (ADC). It needs Node.js 22+, which the Docker image already uses.

Analysis is **off by default** (`VERTEX_AI_ENABLED=false`). The rest of the site
works without it. Vertex API calls cost money, so leave it off until you are
ready.

## Setup

1. Choose a Google Cloud project with billing enabled. Enable the Vertex AI API
   and grant the runtime identity `roles/aiplatform.user`. For local
   development, install the Google Cloud CLI and run:

   ```powershell
   gcloud services enable aiplatform.googleapis.com --project YOUR_PROJECT_ID
   gcloud auth application-default login
   gcloud auth application-default set-quota-project YOUR_PROJECT_ID
   ```

2. Add these values to `csp-backend/.env`. Don't commit credentials.

   ```dotenv
   VERTEX_AI_ENABLED=true
   GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID
   GOOGLE_CLOUD_LOCATION=global
   VERTEX_MODEL=YOUR_AVAILABLE_GEMINI_MODEL_ID
   ```

   Pick a Gemini model in your project that supports PDF input and structured
   output.

3. **Running with Docker:** set `GOOGLE_ADC_HOST_PATH` to your ADC file. The root
   `docker-compose.yaml` then mounts it read-only into the backend. Set it in
   your shell or in a root `.env` file, and put only the path there, never the
   file contents. From the repository root:

   ```powershell
   $env:GOOGLE_ADC_HOST_PATH = "$env:APPDATA\gcloud\application_default_credentials.json"
   docker compose up -d --build --renew-anon-volumes backend
   ```

   On macOS/Linux the file is usually
   `$HOME/.config/gcloud/application_default_credentials.json`. If
   `GOOGLE_ADC_HOST_PATH` is unset, no credentials are mounted and the AI worker
   reports ADC as unavailable.

   **Running without Docker:** `npm run dev` uses your local ADC automatically.
   Don't set `GOOGLE_APPLICATION_CREDENTIALS` to a Docker-only path. On Google
   Cloud, use an attached service identity instead of downloading keys.

4. New projects start with `analysisStatus=pending`. A background worker picks up
   one project every 10 seconds. Scraper updates keep completed analysis.
   To queue projects that existed before this feature:

   ```bash
   node scripts/queue-tor-analysis.js
   # Docker: docker compose exec -T backend node scripts/queue-tor-analysis.js
   ```

- Temporary errors (429, 5xx, timeouts) are retried at most 3 more times, about
  1, 2 and 4 minutes later plus jitter.
- Admins can retry a project with `POST /api/projects/:id/analyze`. HTTP 202 means
  the project was queued, not that analysis finished.
- A 15-minute lease recovers work after a process crash. A crash after a
  successful AI call but before the result is saved can cause a repeated call.

## Stored result and matching

- `descriptions`: Thai summary taken from the actual TOR PDF. The original
  `description` stays as source metadata.
- `requiredSkills`: existing Skill ObjectIds. AI skill names are normalized, and
  common aliases are resolved.
- `aiAnalysis`: mandatory skill names, unknown `unmappedSkillNames`, and document URLs.
  `aiAnalysis.skillEvidence` stores quotes and 1-based PDF page and document
  indexes, in the order of `documentUrls`.
- `analysisStatus`, `analysisError`, `analyzedAt`, `aiModel`, `aiPromptVersion`:
  processing state and where the result came from.

`GET /api/projects/:id` exposes the result. Authenticated
`GET /api/projects/:id/match` compares the TOR against the signed-in user's `proficiency`:

```json
{"matchPercentage":66.67,"matchedSkillIds":["a","b"],"missingSkillIds":["c"],"requiredCount":3,"reason":null}
```

Percentage = unique matching mandatory skills ÷ unique mandatory skills × 100.
Pending or failed analysis, empty mandatory skills, or unmapped requirements
give `matchPercentage: null`, never a misleading 100%.

New skill names that come with a TOR quote, page and document index are
normalized and added to the shared catalog. Names without evidence are not
created automatically. The model extracts the evidence, so check it against the
PDF: it is not a guarantee of correctness. Admins can also add skills through
the Skills API, and the match endpoint uses the current catalog without another
AI call. No user profile is sent to Vertex AI.

## Statuses and what gets skipped

| Status | Meaning |
| --- | --- |
| `pending` | waiting for the worker |
| `awaiting_documents` | TOR or scope document missing |
| `needs_review` | document limits hit or model output malformed |
| `retry_pending` | temporary error, will retry |
| `failed` | permanent error or retries used up |
| `skipped` | deliberately excluded; see `analysisSkipReason` |

A result with no skills is valid only when `aiAnalysis.noMandatorySkillsReason`
is set.

- Setting `analysisAutoEligible=false` turns off automatic analysis for a
  project. New projects are eligible by default.
- The worker skips bids known to be expired, awarded, cancelled, closed or in
  draft before it downloads documents or calls AI. Projects with an unknown
  deadline are still analysed.
- Listing refreshes can't re-enable an excluded record. An admin retry or
  `node scripts/repair-tor-analysis.js --apply --reanalyze PROJECT_ID` can, but
  the deadline and status checks still apply.

### Maintenance scripts

- `node scripts/repair-tor-analysis.js` previews a reclassification of old
  failures, with no new AI calls. Add `--apply` to apply it. Add
  `--reanalyze PROJECT_ID` to queue one project with the v2 prompt. The running
  worker then calls Vertex AI, which is billed as normal.
- `node scripts/select-recent-analysis.js --limit 20 --plan tmp/batch-UNIQUE_NAME.json`
  prepares a limited batch while Vertex is disabled. Review the snapshot, then
  re-run with `--apply` and the same `--plan` path. Keep the backend stopped
  during preview and apply. With Docker, use a one-off container with
  `-e VERTEX_AI_ENABLED=false` if your `.env` enables AI.

## Documents and limits

Bangkok e-GP TOR URLs come from `ProjectTors/GetTorInProject`, with relevant
procurement announcements as a fallback. When the source leaves out announcement
type labels, attachment filenames are used instead. Winner and cancellation
files never count as TOR documents. Official detail statuses C01 (contract/PO
prepared), C04 (work delivered) and S5 (cancelled) remove a record from open
opportunities.

Direct PDF URLs, and HTML pages that link to PDFs, are supported only on hosts
listed in `TOR_ALLOWED_HOSTS`. Use exact, trusted public hostnames and don't add
internal services. Redirects are checked again. HTML-only TORs, inaccessible
documents, non-PDF files and missing scope fail visibly. PDFs are sent to Vertex
AI from memory and are not stored in MongoDB or on disk.

Limits:

- 5 attachments, 15 MiB per download, 20 MiB combined
- 30-second source request timeout, 120-second AI timeout

Sources over these limits fail rather than being silently truncated. A match
measures technical skill coverage. It doesn't decide procurement eligibility or
guarantee suitability.

The `bangkok-documents` and `vertex-extraction` Postman simulations
(`postman/simulations/`) test the document resolver and extraction over HTTP
without paid AI calls. So does `scripts/test-bangkok-documents-simulation.js`.

Official references: [Google Gen AI SDK](https://github.com/googleapis/js-genai)
and [Vertex AI quickstart](https://cloud.google.com/vertex-ai/generative-ai/docs/start/quickstart).
