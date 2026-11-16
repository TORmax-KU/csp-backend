# Project alert preferences

`PATCH /api/users/:id` is authenticated and restricted to the account owner.
The following optional fields are strict booleans:

| Field | Default | Rule |
| --- | --- | --- |
| notifyMatchesInApp | true | Matching project to the notification page |
| notifyMatchesEmail | false | Matching project to the account email |
| notifyHighBudgetInApp | false | Matching project with budget strictly over THB 10,000,000 to the notification page |
| notifyHighBudgetEmail | false | Matching project with budget strictly over THB 10,000,000 to the account email |

All four rules require the saved `matchThreshold` (50–95%, default 75%) and
the vendor's budget range. High-budget options never bypass matching.
Changing preferences triggers a matching sweep. Disabling alerts does not
remove matched opportunities or already-delivered notifications.

Both rules qualifying for the same match produce one alert per selected channel.
Enabling another channel can deliver an existing match on that channel once.
Tracked match state changes use the same selected channels and budget rule.
In-app notifications remain separate from the persistent email queue. Email is
opt-in; legacy daily-digest and SMS fields do not opt users into email delivery.

Email requires explicit server SMTP configuration and EMAIL_ALERTS_ENABLED=true.
Pending email is rechecked against current account status, preferences, matching,
and project availability before sending. Transient failures retry with backoff;
permanent failures stop. SMTP acknowledgement does not establish inbox delivery.

## Verification

The local automated suite covers all 16 switch combinations, the strict THB 10M
boundary, saved thresholds and budget ranges, overlapping-rule deduplication,
newly enabled channels, retry after dispatch failure, and profile API validation
and ownership. The actual Nodemailer SMTP transport is exercised against an
isolated local SMTP server for acceptance, temporary 450 rejection/recovery,
permanent 550 rejection, and retry exhaustion. No real recipient is contacted.
Queue models in these tests are controlled stand-ins; the two existing MongoDB
integration tests require TEST_MONGO_URI and remain skipped without it. External
provider authentication, sender verification, and inbox placement remain unverified.

The installed Postman CLI rejects `postman status` as an unknown command. The
contract stays local; no workspace resources or public mocks were published.
