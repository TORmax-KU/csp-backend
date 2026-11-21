const test = require("node:test");
const assert = require("node:assert/strict");
const Project = require("../src/models/Project");
const ClassificationReport = require("../src/models/ClassificationReport");
const { reportClassification, reviewClassificationReport, fetchClassificationReports } = require("../controllers/ClassificationReportController");

const ID = "6ae0b63ffb773330336475e6";
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const lean = value => ({ select: () => ({ lean: async () => value }), lean: async () => value });

test("Open Issue 2: a signed-in user's report is saved once per TOR and reopens on repeat", async t => {
  let upsert;
  t.mock.method(Project, "findById", () => lean({ status: "Public", source: "bangkok-egp" }));
  t.mock.method(ClassificationReport, "findOneAndUpdate", (filter, update, options) => { upsert = { filter, update, options }; return lean({ reason: "not-it", updatedAt: new Date() }); });
  const res = response();
  await reportClassification({ params: { id: ID }, user: { _id: "u1" }, body: { reason: "not-it", note: "  Uniform purchase  " } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reported, true);
  assert.deepEqual(upsert.filter, { projectId: ID, userId: "u1" });
  assert.equal(upsert.update.$set.note, "Uniform purchase");
  assert.equal(upsert.update.$set.status, "open");
  assert.equal(upsert.options.upsert, true);
});

test("reports need a valid reason, a note for 'other', and a public government TOR", async t => {
  t.mock.method(ClassificationReport, "findOneAndUpdate", () => assert.fail("must not save"));
  const send = async (body, project = { status: "Public", source: "bangkok-egp" }, id = ID) => {
    t.mock.method(Project, "findById", () => lean(project));
    const res = response();
    await reportClassification({ params: { id }, user: { _id: "u1" }, body }, res);
    return res.statusCode;
  };
  assert.equal(await send({ reason: "spam" }), 400);
  assert.equal(await send({ reason: "other", note: " " }), 400);
  assert.equal(await send({ reason: "not-it", note: "x".repeat(501) }), 400);
  assert.equal(await send({ reason: "not-it" }, null), 404);
  assert.equal(await send({ reason: "not-it" }, { status: "Public", source: "direct" }), 404);
  assert.equal(await send({ reason: "not-it" }, undefined, "bad-id"), 404);
});

test("an admin can resolve a report and remove the TOR from the IT feed", async t => {
  const saved = [];
  const report = { projectId: ID, status: "open", save: async () => saved.push("report") };
  t.mock.method(ClassificationReport, "findById", async () => report);
  let reclassified, resolvedOthers;
  t.mock.method(Project, "updateOne", async (filter, update) => { reclassified = { filter, update }; });
  t.mock.method(ClassificationReport, "updateMany", async (filter, update) => { resolvedOthers = { filter, update }; });
  const res = response();
  await reviewClassificationReport({ params: { id: "6ae0b63ffb773330336475e7" }, user: { _id: "admin" }, body: { status: "resolved", markNonSoftware: true } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(reclassified.update.$set.classification, "non-software");
  assert.deepEqual(resolvedOthers.filter, { projectId: ID, status: "open" });
  assert.equal(report.status, "resolved");
  assert.equal(report.resolvedBy, "admin");
  assert.deepEqual(saved, ["report"]);

  const dismiss = response();
  await reviewClassificationReport({ params: { id: "6ae0b63ffb773330336475e7" }, user: { _id: "admin" }, body: { status: "dismissed", markNonSoftware: true } }, dismiss);
  assert.equal(dismiss.statusCode, 400);
});

test("admin queue rejects a status outside the ClassificationReport enum, including an injection attempt", async t => {
  const res1 = response();
  await fetchClassificationReports({ query: { status: "deleted" } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = response();
  await fetchClassificationReports({ query: { status: { $ne: "open" } } }, res2);
  assert.equal(res2.statusCode, 400);
});

test("admin queue lists open reports by default, newest first", async t => {
  const rows = [{ _id: "r1", status: "open" }];
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => rows };
  t.mock.method(ClassificationReport, "find", () => chain);
  t.mock.method(ClassificationReport, "countDocuments", async () => 1);
  const res = response();
  await fetchClassificationReports({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { reports: rows, total: 1, page: 1, limit: 20 });
});

test("admin queue also filters by resolved or dismissed status", async t => {
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => [] };
  let usedQuery;
  t.mock.method(ClassificationReport, "find", (query) => { usedQuery = query; return chain; });
  t.mock.method(ClassificationReport, "countDocuments", async () => 0);

  await fetchClassificationReports({ query: { status: "resolved" } }, response());
  assert.deepEqual(usedQuery, { status: "resolved" });

  await fetchClassificationReports({ query: { status: "dismissed" } }, response());
  assert.deepEqual(usedQuery, { status: "dismissed" });
});
