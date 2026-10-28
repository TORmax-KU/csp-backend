# Bangkok document metadata simulation

Created 2026-10-28 from the official Bangkok detail/announcement response shapes.
No connected owner mock was available. Fixture IDs/PDF bytes are synthetic;
the observed C01 contract status and null-type winner filename are retained.

## Purpose

Exercise `BangkokEgpDetailClient` and `TorSource` over real local HTTP, covering
contracted projects, missing announcement types, winner exclusion, and source errors.

## Execution

From `csp-backend`: `postman simulation run postman/simulations/bangkok-documents.sim.yaml --port 4910 --no-history --output ndjson`.
From root: `docker compose exec -T backend node scripts/test-bangkok-documents-simulation.js`.
Stop the simulation with Ctrl+C after the assertions finish.

## Assumptions

- 2026-10-28: Docker reached this host simulation through `host.docker.internal`, verified by the client assertions and the member request events.
- The transport adapter retains the production logical HTTPS URLs and maps their paths into the simulation member; normal production host validation is unchanged.
- This proves resolver/status HTTP behavior, not live document availability, PDF semantics, Vertex extraction, or future procurement eligibility.

## Observations

<!-- begin:observations -->
2026-10-28: the sole `bangkok` member served all seven requests, including attachment verification and a source HTTP 500. All client assertions passed. No Vertex calls or project writes occurred.
<!-- end:observations -->
