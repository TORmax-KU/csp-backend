# Audit API corrections

- `GET /auth/options`: public, no-store JSON `{ googleEnabled: boolean }`.
  No credentials or provider configuration values are returned.
- `PATCH /api/users/:id`: owner-only. Numeric fields must be actual JSON numbers
  (nullable for budgets/team/capacity). Team/capacity/years/threshold are whole
  numbers. Budget comparisons use the merged old/new profile. Invalid fields
  return 400 with `errors`; duplicate username returns 409.
- `GET /api/matches`: recomputes scores and budget eligibility against current
  qualifications; cached matches cannot override a newly raised threshold.
- `GET /api/notifications`: positive integer page, limit 1–100, optional read
  exactly `true` or `false`; invalid query returns 400. Older pages remain scoped
  to the authenticated account and exclude dismissed entries.
- `PATCH/DELETE /api/projects/:id`: malformed IDs return 404. Existing publisher
  ownership and admin authorization remain enforced. Invalid contacts return
  validation errors rather than server exceptions.
- `GET /api/projects/:id/match`: non-public projects return 404.

Regression evidence: ProfileValidation.test.js, MatchRoutes.test.js,
IngestionHealth.test.js and the disposable-stack API audit. The installed Postman
CLI does not support `postman status`; no workspace artifacts were published.
