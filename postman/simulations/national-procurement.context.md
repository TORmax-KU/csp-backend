# National procurement simulation

2026-10-28: local mocks follow Tero's published API contract and observed ZIP
names, plus the official GovSpending service definition and authenticated
response shape. No connected owner mock was available. Fixture identities and
PDF bodies are synthetic; `simulation-only` is a deliberately fake credential.

From `csp-backend`, run:

```
postman simulation run postman/simulations/national-procurement.sim.yaml --port 4911 --no-history --output ndjson
node scripts/test-national-procurement-simulation.js
```

The transport adapter preserves production HTTPS host validation and forwards
paths to the local `procurement` member. Both clients and the ZIP resolver run
over real HTTP. Stop the server with Ctrl+C after the assertions finish.

2026-10-28: passed cutoff boundary/older exclusion, auth, pagination response,
cross-provider identity mapping, contract/award exclusion, credential removal,
ZIP invitation/TOR selection, and HTTP 503/401 handling. Request events confirmed
that all three changed HTTP paths reached the simulation. This does not prove
live coverage or PDF semantics. Live API ingestion and paid Vertex analysis were
verified separately; mocked PDF bytes are never sent to Vertex.
