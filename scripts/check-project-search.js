// Read-only smoke check against the local API. Run after starting the backend.
const assert = require("node:assert/strict");
const base = process.env.SEARCH_CHECK_URL || "http://localhost:5000";
async function get(params) {
  const response = await fetch(`${base}/api/projects?${new URLSearchParams(params)}`);
  assert.equal(response.status, 200);
  return response.json();
}
(async () => {
  const all = await get({ availability: "all", limit: "100" });
  assert.ok(all.projects.every(p => ["open", "unknown"].includes(p.availability)));
  for (const availability of ["open", "unknown"]) {
    const result = await get({ availability, limit: "100" });
    assert.ok(result.projects.every(p => p.availability === availability));
    const sample = result.projects[0];
    if (sample) {
      const search = await get({ availability: "all", search: sample._id });
      assert.equal(search.total, 1);
      assert.equal(search.projects[0]._id, sample._id);
    }
    console.log(`${availability}: ${result.total}; ID search checked: ${Boolean(sample)}`);
  }
  const missing = await get({ availability: "all", search: "no-match-regression-12d5ef6c" });
  assert.equal(missing.total, 0);
  assert.deepEqual(missing.projects, []);
  const invalid = await fetch(`${base}/api/projects?availability=invalid`);
  assert.equal(invalid.status, 400);
  console.log(`All verified: ${all.total}; eligibility, ID searches, empty results and validation passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
