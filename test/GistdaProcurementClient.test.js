const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRow } = require("../src/services/GistdaProcurementClient");

test("GISTDA row parser converts a dd/mm/yyyy date to ISO", () => {
  const record = parseRow({ project: "69099528075", title: "Build a booking system", type: "IT", date: "15/3/2026", url: "https://example.go.th/x" });
  assert.equal(record.externalId, "69099528075");
  assert.equal(record.deadline, "2026-03-15");
  assert.equal(record.agency, "GISTDA");
  assert.equal(record.sourceUrl, "https://example.go.th/x");
});

test("GISTDA row parser leaves the deadline unset for a malformed date", () => {
  assert.equal(parseRow({ project: "1", title: "x", date: "not-a-date" }).deadline, undefined);
  assert.equal(parseRow({ project: "1", title: "x", date: "31/13/abcd" }).deadline, undefined);
  assert.equal(parseRow({ project: "1", title: "x" }).deadline, undefined);
});

test("GISTDA row parser falls back to the internal id when there is no e-GP project number", () => {
  const record = parseRow({ id: "internal-9", title: "x" });
  assert.equal(record.externalId, "internal-9");
  assert.equal(record.sourceUrl, "https://www.gistda.or.th/procurement/");
});
