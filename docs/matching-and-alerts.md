# Vendor matching, notifications and email alerts

## Matching

`src/services/MatchingEngine.js` compares every active Vendor who has saved
skills against the open public feed. It runs at startup, every five minutes, and
right after a vendor saves their skills, budget range or match threshold.

A TOR matches when both of these are true:

- the vendor covers at least `matchThreshold`% (default 75) of its mandatory
  skills, using the same score as `GET /api/projects/:id/match`;
- its budget is inside the vendor's `minBudget`–`maxBudget`, when those are set.

What vendors are notified about:

- A new match creates a `NewMatch` notification. A match that stops qualifying
  while the TOR is still open is dropped without a notification.
- When a matched TOR moves between open, closed, awarded, cancelled and draft, a
  `StatusChange` notification is created. The temporary `unknown` state is
  ignored.
- Each event notifies only once, even across concurrent runs or several
  backends.
- `MATCHING_ENABLED=false` stops the sweep.

## Alert preferences

Part 5 of Edit Profile has four independent switches:

- matching projects, in-app
- matching projects, by email
- matching projects over THB 10 million, in-app
- matching projects over THB 10 million, by email

Every rule uses the vendor's saved minimum skill match and budget range. Exactly
THB 10 million doesn't count as over. A project that qualifies under both rules
produces one alert per channel, and status changes use the same channel choices.

In-app matching alerts are on by default. Email and the over-THB-10-million
switches are off by default. The old daily-digest and SMS preferences are no
longer used and don't opt users in to anything.

## Email (SMTP)

Set these on the backend:

```dotenv
EMAIL_ALERTS_ENABLED=true
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM=
FRONTEND_URL=http://localhost:3000
```

- `FRONTEND_URL` must be the website address as seen from a browser, so email
  links point to the right site.
- Port 587 uses STARTTLS, which is required. Port 465 usually needs
  `SMTP_SECURE=true`.
- A local SMTP test server can use `SMTP_ALLOW_INSECURE_LOCAL=true` with a
  loopback host. This is never allowed in production.
- Keep the credentials out of Git.

How emails are sent:

- Emails go into a queue that is separate from the in-app notification list.
  The backend checks the queue every 30 seconds, a limited batch at a time.
- Before sending, it checks preferences, account status, the match and project
  availability again.
- Temporary errors are retried up to five times with increasing delays.
  Permanent delivery failures stop.
- The `emailAlerts` collection records pending, processing, sent, skipped and
  failed states. It doesn't store SMTP secrets.
- A successful SMTP response means the mail server accepted the email, not that
  it reached the inbox.
- If the process fails after the server accepts an email, the retry can send a
  duplicate. Stable Message-IDs help mail clients spot duplicates, but sending
  exactly once is not guaranteed.

Emails are sent as events happen. There is no daily digest and no SMS.
