const test = require("node:test");
const assert = require("node:assert/strict");
const { pendingTorExtraction } = require("../src/services/PendingTorExtraction");
const { processNext } = require("../src/services/TorAnalysisWorker");
const { ProjectSchema } = require("../schemas/ProjectModel");
const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const IngestionLog = require("../src/models/IngestionLog");
const { ingestRecords } = require("../src/services/IngestionPipeline");
const { create } = require("../controllers/ProjectController");

test("reset retains valid database types and invalidates stale AI leases", () => {
  const Model = mongoose.models.PendingExtractionTest || mongoose.model("PendingExtractionTest", ProjectSchema);
  const project = new Model({ title: "Existing TOR", ...pendingTorExtraction() });
  assert.equal(project.validateSync(), undefined);
  assert.equal(project.budget, null);
  assert.equal(project.deadline, null);
  assert.equal(project.announcedAt, null);
  assert.equal(project.analysisLease, null);
  assert.equal(project.analysisHold, true);
  assert.equal(project.analysisStatus, "pending");
});

test("held records cannot be claimed by the old extractor", async () => {
  let queried = false;
  const result = await processNext({ projects: {
    findOneAndUpdate: async query => {
      queried = true;
      assert.deepEqual(query.analysisHold, { $ne: true });
      return null;
    },
  }, load: async () => assert.fail("Held documents must not be loaded"), analyze: async () => assert.fail("Held records must not call Vertex") });
  assert.equal(queried, true);
  assert.equal(result, false);
});

test("scheduled ingestion cannot restore invalid budget or deadline on a held TOR", async t => {
  const sourceUrl = "https://egp2.bangkok.go.th/project-detail/example";
  t.mock.method(Project, "findOne", () => ({ select: async () => ({ _id: "existing", sourceUrl, analysisHold: true, procurementStatus: "open" }) }));
  let written;
  t.mock.method(Project, "findByIdAndUpdate", async (_id, patch) => { written = patch.$set; });
  t.mock.method(IngestionLog, "create", async value => value);
  await ingestRecords({ source: "bangkok-egp", sourceUrl, records: [{ externalId: "example", title: "Software development", budget: 999999, deadline: "2569-10-20", sourceUrl }] });
  assert.ok(written);
  assert.equal(written.budget, undefined);
  assert.equal(written.deadline, undefined);
  assert.equal(written.procurementStatus, undefined);
  assert.equal(written.analysisHold, undefined);
});

test("new user projects queue AI extraction instead of trusting submitted metadata", async t => {
  let saved;
  t.mock.method(Project, "create", async value => { saved = value; return value; });
  const response = { status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } };
  await create({ user: { role: "Admin", _id: "owner" }, body: {
    title: "New TOR", sourceUrl: "https://egp2.bangkok.go.th/tor.pdf", budget: 999999,
    deadline: "2026-12-31", requiredSkills: ["unverified"],
  } }, response);
  assert.equal(response.statusCode, 201);
  assert.equal(saved.analysisStatus, "pending");
  assert.equal(saved.analysisHold, false);
  assert.equal(saved.budget, null);
  assert.equal(saved.deadline, null);
  assert.deepEqual(saved.requiredSkills, []);
});
