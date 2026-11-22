# Public feed and data rules

Rules for which projects the API shows publicly, and how it treats deadlines,
drafts and privacy.

## What the default search returns

- The default API search returns only public, verified technology projects from
  [supported sources](data-sources.md). Each one has a future bid deadline,
  source status `open`, and a verified TOR document. Open direct postings from
  Job Listers are included as well.
- Closed, awarded, cancelled, draft and expired projects can't be brought back by
  changing search parameters. Expiry is checked at request time.
- Source and document checks must be less than 24 hours old, so stale data is
  never shown as current indefinitely. This doesn't rule out a source changing
  between syncs.
- The live home page and TOR detail pages use database records only. Never
  invent deadlines or verification metadata to fill the results.

## Deadlines

- Exact (`datetime`) deadlines close at their exact time. Date-only or
  unknown-precision deadlines stay listed through their Bangkok calendar date.
  The UI then shows a date rather than an invented time. This doesn't confirm
  that submissions are accepted for the whole of that date.
- Unknown deadlines carry an explicit warning on cards and detail pages. They
  are never described as open indefinitely.
- Procurement start, announcement, document sale end and final submission
  deadline are separate database fields. Fields missing from the source stay
  missing in the UI. AI summaries are labelled separately and never supply dates.

## Search parameters

- `availability`: `open` (the API default) shows eligible future deadlines.
  `unknown` shows only unknown deadlines. `all` combines both, and the website
  uses it by default so missing deadlines don't silently hide matches. Every
  mode keeps the source, TOR verification and terminal-status exclusions. Date
  filters in `all` mode exclude unknown deadlines.
- `deadlineYear=2569` (or `2026`) and `deadlineFrom`/`deadlineTo=YYYY-MM-DD`
  filter final submission dates using Bangkok calendar boundaries.
- `sort`: `deadline` (default), `newest` or `budget`. Agency, method and budget
  filters combine with text search and pagination.
- Text search matches a literal phrase (case-insensitive), not translations or
  synonyms. No matches returns HTTP 200 with `projects: []` and `total: 0`.
  Malformed filters return HTTP 400.
- The technology classifier includes IT hardware and system maintenance. It
  excludes paper, stationery and printer consumables. Ambiguous procurement
  titles still need a human to check the source.

## Draft TORs (FR-05)

A draft TOR is published for public comment before bidding opens.
`status: "Draft"` and `procurementStatus: "draft"` always change together.

- **Bangkok e-GP:** the listing API has no status field, so drafts are detected
  from the project's announcements during enrichment:
  - A project whose only TOR announcements are drafts
    (`ร่างขอบเขตของงาน (TOR)`, `ร่างเอกสารประกวดราคา ...`) is a draft.
  - A final invitation (`ประกาศเชิญชวน`) opens it.
  - A winner or cancellation notice overrides both.
  - `draftPublishedAt` is the date of the latest draft announcement.
  - The 5-minute listing scrape never changes `status`.
- **National sources:** a listing status containing `ร่าง`/`draft` marks a draft.
  When the listing stops saying so, the project is no longer a draft.
- **No AI cost while in draft:** drafts skip Vertex analysis. Analysis is
  switched back on automatically when the draft becomes public, and runs on the
  final TOR.
- **Listing:**
  - `GET /api/projects?status=Draft` lists drafts.
  - `status=all` lists open TORs first, then drafts.
  - Without `status`, you get the open feed.
  - A draft stays listed while its source has shown it within the last 2 days,
    and for at most 90 days after publication.
  - Drafts have no closing date, so closing-date filters exclude them.
  - Drafts can be opened, bookmarked and reported as misclassified like other
    TORs.

## Privacy

User profiles are private:

- `GET /api/users` requires an administrator.
- `GET /api/users/:id` requires the account owner or an administrator.
- Anonymous requests return 401. Requests for someone else's account return 403.
  Invalid IDs return 404 for authorized readers.
- Public project responses leave out the publisher's email.

## Legacy data cleanup

- `node scripts/audit-demo-data.js` (with `MONGO_URI` set) does a read-only check
  for the date patterns left by the retired demo-data script. Matches are
  records to review against their source, not proof that they should be deleted.
- `node scripts/remove-retired-procurement.js` previews how many `bangkok-egp`
  projects without a publisher would be removed. Add `--apply` to delete them
  along with their matches and notifications. Users, profiles, skills and other
  sources are not touched. Run it after updating and restarting the backend.
