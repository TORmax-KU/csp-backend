# Vertex extraction simulation

Created 2026-10-26 from Google's generateContent response envelope and the local
test contract in `postman/specs/vertex-extraction.yaml`. No connected owner
workspace was available; the handler uses synthetic extraction content.

## Purpose

Run the actual Google SDK, analyzer and worker against a local HTTP stand-in;
verify request shape, response validation, 429 handling and MongoDB persistence.

## Execution

From `csp-backend`: `postman simulation run postman/simulations/vertex-extraction.sim.yaml --port 4900 --no-history --output ndjson`.
From repository root: `docker compose run --rm --no-deps backend node scripts/test-vertex-simulation.js`.
Stop the simulation with Ctrl+C. The test cleans up its uniquely named local test database.

## Assumptions

- Observed 2026-10-26: Docker reaches the host simulation through `host.docker.internal`; the local `mongo` service must be running. Atlas is never used.
- Observed 2026-10-26: `tmp/pdfs/pbis-0.pdf` is a scanned local fixture with at least six pages. It is ignored, not committed. Supply another suitable PDF as the script's first argument and adjust the synthetic budget citation if necessary.
- The simulation proves HTTP/SDK/persistence behavior, not Google's credentials, PDF comprehension or source availability. Live model checks are described in `docs/vertex-extraction.md`.

## Observations

<!-- begin:observations -->
2026-10-26: the sole member `vertex` served successful generateContent requests and a 429. The SDK assertions and isolated local MongoDB worker persistence check passed; no member was silent.
<!-- end:observations -->

## What didn't work

- CLI 1.75.0 requires the member path to name `config.yaml`, not its directory.
- Fake private-key credentials fail in the auth client before HTTP; the test uses a local OAuth token with expiry instead.
