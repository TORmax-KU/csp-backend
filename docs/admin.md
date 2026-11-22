# Admin console and moderation (US9, US10, UC5)

## Creating the first admin

Registration only offers the Vendor and Job Lister roles, so you promote an
account to admin with a script. The script also re-activates the account and
signs out its old sessions.

```bash
node scripts/create-admin.js --email you@example.com
# or create a new email/password admin; the password comes from the environment:
ADMIN_PASSWORD='choose-a-strong-one' node scripts/create-admin.js --email you@example.com --create
# Docker (run from the repository root):
docker compose exec -e ADMIN_PASSWORD='…' -T backend node scripts/create-admin.js --email you@example.com --create
```

Sign in again, then open **Admin Portal** in the menu (`/admin`).

## Reporting a direct posting

Any signed-in user except the publisher can report a direct job posting from its
page (`POST /api/projects/:id/report`). The reasons are `spam`, `fraud`,
`not-it`, `offensive` and `other`. Each user gets one report per posting:
reporting again updates the existing report. Government TORs use
misclassification reports instead.

## Misclassification reports (Open Issue 2)

Signed-in users can flag a government TOR from its detail page
(`POST /api/projects/:id/classification-report`), once per user per TOR. Admins
handle these in the **Misclassified TORs** tab at `/admin`, or through the API:

- `GET /api/admin/classification-reports?status=open` lists them.
- `PATCH /api/admin/classification-reports/:id` sets `status` to `resolved` or
  `dismissed`. Add `markNonSoftware: true` to remove the TOR from the IT feed.

## Removing a posting (FR-14 / NFR-11)

`DELETE /api/admin/posts/:id` requires a body of `{ "reason": "…" }`. Only direct
job postings can be removed this way. The steps run in this order:

1. The publisher is set to `Disabled` and their sessions are revoked. An Admin
   publisher is never disabled.
2. The publisher's other open postings are closed.
3. A moderation log entry is written, including a copy of the title and the
   publisher's email.
4. The posting is deleted. Its open reports are resolved as `removed`, and
   vendor notifications about it are hidden.

There is no transaction, because the Docker MongoDB is a standalone server and
refuses transactions. Each step is safe to repeat, so if a request fails part-way
the admin can simply retry. By then the account is already disabled.

## Other admin endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/admin/posts?status=open\|closed\|all&search=` | every direct posting with its open report count |
| `GET /api/admin/post-reports?status=open` | posting reports |
| `PATCH /api/admin/post-reports/:id` | set `status` to `resolved`, `dismissed` or `open` |
| `GET /api/users?search=&role=&status=` | list users |
| `PATCH /api/admin/users/:id/status` | enable or disable a user (admins can't change their own status or disable another admin) |
| `GET /api/admin/moderation-logs` | moderation history |
| `GET /api/admin/ingestion-health?days=7` | scraper success rates ([details](data-sources.md#scraper-health-and-alerts)) |
