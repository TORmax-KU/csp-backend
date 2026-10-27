const test = require("node:test");
const assert = require("node:assert/strict");
const { toProjectDocument } = require("../src/services/IngestionPipeline");

test("a Bangkok detail page is not treated as a verified TOR PDF", () => {
  const sourceUrl = "https://egp2.bangkok.go.th/project-detail/project-1";
  const project = toProjectDocument({
    externalId: "project-1",
    title: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)",
    sourceUrl,
  }, "bangkok-egp", sourceUrl, { matchedKeywords: [] });
  assert.equal(project.sourceUrl, sourceUrl);
  assert.deepEqual(project.documents, []);
  assert.equal(project.dataVerified, false);
  assert.equal(project.sourceVerifiedAt, null);
});
