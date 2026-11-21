const test = require("node:test");
const assert = require("node:assert/strict");
const Project = require("../src/models/Project");
const PostReport = require("../src/models/PostReport");
const { reportPost, reviewPostReport, fetchPostReports } = require("../controllers/PostReportController");

const ID = "6ae0b63ffb773330336475e6";
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const lean = value => ({ select: () => ({ lean: async () => value }), lean: async () => value });
const posting = { _id: ID, title: "Mobile app for a clinic", status: "Public", source: "direct", publisherId: "lister" };

test("UC5: a signed-in user's report on a job posting is saved once and reopens on repeat", async t => {
  let upsert;
  t.mock.method(Project, "findById", () => lean(posting));
  t.mock.method(PostReport, "findOneAndUpdate", (filter, update, options) => { upsert = { filter, update, options }; return lean({ reason: "fraud", updatedAt: new Date() }); });
  const res = response();
  await reportPost({ params: { id: ID }, user: { _id: "vendor" }, body: { reason: "fraud", note: "  Asks for a deposit up front  " } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reported, true);
  assert.deepEqual(upsert.filter, { projectId: ID, userId: "vendor" });
  assert.equal(upsert.update.$set.note, "Asks for a deposit up front");
  assert.equal(upsert.update.$set.projectTitle, "Mobile app for a clinic");
  assert.equal(upsert.update.$set.status, "open");
  assert.equal(upsert.options.upsert, true);
});

test("post reports need a valid reason, a note for 'other', a public direct posting, and not your own", async t => {
  t.mock.method(PostReport, "findOneAndUpdate", () => assert.fail("must not save"));
  const send = async (body, project = posting, { id = ID, user = "vendor" } = {}) => {
    t.mock.method(Project, "findById", () => lean(project));
    const res = response();
    await reportPost({ params: { id }, user: { _id: user }, body }, res);
    return res.statusCode;
  };
  assert.equal(await send({ reason: "wrong-category" }), 400);
  assert.equal(await send({ reason: "other", note: " " }), 400);
  assert.equal(await send({ reason: "spam", note: "x".repeat(501) }), 400);
  assert.equal(await send({ reason: "spam" }, null), 404);
  assert.equal(await send({ reason: "spam" }, { ...posting, source: "bangkok-egp" }), 404);
  assert.equal(await send({ reason: "spam" }, { ...posting, status: "Draft" }), 404);
  assert.equal(await send({ reason: "spam" }, posting, { id: "bad-id" }), 404);
  assert.equal(await send({ reason: "spam" }, posting, { user: "lister" }), 400);
});

test("an admin can dismiss a report, but cannot reopen one whose posting was removed", async t => {
  const report = { status: "open", outcome: "", save: async () => {} };
  t.mock.method(PostReport, "findById", async () => report);
  const dismiss = response();
  await reviewPostReport({ params: { id: ID }, user: { _id: "admin" }, body: { status: "dismissed" } }, dismiss);
  assert.equal(dismiss.statusCode, 200);
  assert.equal(report.status, "dismissed");
  assert.equal(report.resolvedBy, "admin");

  Object.assign(report, { status: "resolved", outcome: "removed" });
  const reopen = response();
  await reviewPostReport({ params: { id: ID }, user: { _id: "admin" }, body: { status: "open" } }, reopen);
  assert.equal(reopen.statusCode, 400);

  const invalid = response();
  await reviewPostReport({ params: { id: ID }, user: { _id: "admin" }, body: { status: "deleted" } }, invalid);
  assert.equal(invalid.statusCode, 400);
});

test("admin queue rejects a status outside the PostReport enum, including an injection attempt", async t => {
  const res1 = response();
  await fetchPostReports({ query: { status: "deleted" } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = response();
  await fetchPostReports({ query: { status: { $ne: "open" } } }, res2);
  assert.equal(res2.statusCode, 400);
});

test("admin queue lists open reports by default, newest first", async t => {
  const rows = [{ _id: "r1", status: "open" }];
  const chain = { populate: () => chain, sort: () => chain, skip: () => chain, limit: () => chain, lean: async () => rows };
  t.mock.method(PostReport, "find", () => chain);
  t.mock.method(PostReport, "countDocuments", async () => 1);
  const res = response();
  res.set = () => {};
  await fetchPostReports({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { reports: rows, total: 1, page: 1, limit: 20 });
});
