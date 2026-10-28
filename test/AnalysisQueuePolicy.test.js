const test = require("node:test");
const assert = require("node:assert/strict");
const { analysisSkipReason, planAnalysisBatch } = require("../src/services/AnalysisQueuePolicy");
const { processNext, prepareWorker } = require("../src/services/TorAnalysisWorker");

const now = new Date("2026-10-28T05:00:00Z");

test("known expired and terminal bids are skipped; unknown deadlines remain candidates", () => {
  for (const procurementStatus of ["awarded", "cancelled", "closed", "draft"]) {
    assert.ok(analysisSkipReason({ procurementStatus }, now));
  }
  assert.ok(analysisSkipReason({ deadline: now, deadlinePrecision: "datetime" }, now));
  assert.equal(analysisSkipReason({ deadline: "2026-10-27T17:00:00Z", deadlinePrecision: "date" }, now), "");
  assert.ok(analysisSkipReason({ deadline: "2026-10-26T17:00:00Z", deadlinePrecision: "date" }, now));
  assert.equal(analysisSkipReason({ procurementStatus: "unknown", deadline: null }, now), "");
});

test("newest selection uses insertion time with deterministic ID ties, preserves completed output, and skips older retry jobs", () => {
  const entries = planAnalysisBatch([
    { _id: "old", createdAt: "2026-09-01", analysisStatus: "pending" },
    { _id: "done", createdAt: "2026-09-02", analysisStatus: "completed" },
    { _id: "retry", createdAt: "2026-09-03", analysisStatus: "retry_pending" },
    { _id: "a", createdAt: "2026-10-27", analysisStatus: "awaiting_documents" },
    { _id: "b", createdAt: "2026-10-27", analysisStatus: "needs_review", procurementStatus: "awarded" },
  ], 2, now);
  const entry = id => entries.find(e => e.id === id);
  assert.deepEqual(entries.filter(e => e.selected).map(e => e.id), ["b", "a"]);
  assert.equal(entry("a").set.analysisStatus, "pending");
  assert.equal(entry("b").set.analysisStatus, "skipped");
  assert.equal(entry("old").set.analysisStatus, "skipped");
  assert.equal(entry("retry").set.analysisStatus, "skipped");
  assert.equal(entry("done").set.analysisStatus, undefined);
  assert.equal(entry("done").set.analysisAutoEligible, false);
});

test("worker excludes the disabled backlog and never loads documents or calls AI for known obsolete bids", async () => {
  const writes = [];
  await processNext({ projects: {
    findOneAndUpdate: async query => {
      assert.deepEqual(query.analysisAutoEligible, { $ne: false });
      return { _id: "old", sourceUrl: "https://egp2.bangkok.go.th/tor.pdf", procurementStatus: "awarded" };
    },
    updateOne: async (_filter, update) => writes.push(update),
  }, load: async () => assert.fail("Must not download"), analyze: async () => assert.fail("Must not call Vertex") });
  assert.equal(writes[0].$set.analysisStatus, "skipped");
  assert.equal(writes[0].$set.analysisAutoEligible, false);
});

test("worker startup does not release disabled pending records", async () => {
  await prepareWorker({ authenticate: async () => {}, projects: {
    updateMany: async query => {
      assert.deepEqual(query.analysisAutoEligible, { $ne: false });
      return { modifiedCount: 0 };
    },
  } });
});

test("new projects default to automatic analysis and skipped status validates", () => {
  const Project = require("../src/models/Project");
  const project = new Project({ title: "New software TOR" });
  assert.equal(project.analysisAutoEligible, true);
  project.analysisStatus = "skipped";
  assert.equal(project.validateSync(), undefined);
});

test("a changed source URL does not requeue a skipped backlog record", async t => {
  const Project = require("../src/models/Project");
  const Log = require("../src/models/IngestionLog");
  const { ingestRecords } = require("../src/services/IngestionPipeline");
  t.mock.method(Project, "findOne", () => ({ select: async () => ({ _id: "old", sourceUrl: "https://egp2.bangkok.go.th/old", analysisAutoEligible: false, analysisSkipReason: "Old backlog" }) }));
  let patch;
  t.mock.method(Project, "findByIdAndUpdate", async (_id, update) => { patch = update.$set; });
  t.mock.method(Log, "create", async value => value);
  await ingestRecords({ source: "bangkok-egp", records: [{ title: "Software development", externalId: "old", sourceUrl: "https://egp2.bangkok.go.th/new" }] });
  assert.equal(patch.analysisStatus, "skipped");
  assert.equal(patch.analysisSkipReason, "Old backlog");
  assert.equal(patch.analysisAutoEligible, undefined);
});

test("manual admin retry opts a skipped record back into analysis", async t => {
  const Project = require("../src/models/Project");
  const { queueAnalysis } = require("../controllers/TorAnalysisController");
  const previous = process.env.VERTEX_AI_ENABLED;
  process.env.VERTEX_AI_ENABLED = "true";
  t.after(() => { if (previous === undefined) delete process.env.VERTEX_AI_ENABLED; else process.env.VERTEX_AI_ENABLED = previous; });
  t.mock.method(Project, "exists", async () => false);
  t.mock.method(Project, "findOneAndUpdate", async (_query, update) => {
    assert.equal(update.$set.analysisAutoEligible, true);
    assert.equal(update.$set.analysisStatus, "pending");
    assert.equal(update.$set.analysisSkipReason, "");
    return { _id: "6ae0b63ffb773330336475e6", analysisStatus: "pending" };
  });
  const res = { status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
  await queueAnalysis({ user: { role: "Admin" }, params: { id: "6ae0b63ffb773330336475e6" } }, res, error => { throw error; });
  assert.equal(res.statusCode, 202);
});
