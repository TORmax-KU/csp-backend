const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateMatch, resolveSkills, ensureRequiredSkills } = require("../src/services/SkillMatching");
const { analysisError, classifyAnalysisError } = require("../src/services/AnalysisErrors");
const { validateAnalysis } = require("../src/services/VertexTorAnalyzer");
const { checkedUrl, attachmentUrl, loadTor } = require("../src/services/TorSource");
const { processNext } = require("../src/services/TorAnalysisWorker");

test("skill matching deduplicates requirements and supports populated references", () => {
  const project = { analysisStatus: "completed", requiredSkills: ["a", "a", { _id: "b" }, "c"] };
  const match = calculateMatch(project, [{ _id: "a" }, "b", "irrelevant"]);
  assert.equal(match.matchPercentage, 66.67);
  assert.deepEqual(match.missingSkillIds, ["c"]);
  assert.equal(calculateMatch({ ...project, requiredSkills: [] }, []).matchPercentage, null);
  assert.equal(calculateMatch({ ...project, analysisStatus: "failed" }, ["a"]).matchPercentage, null);
  assert.equal(calculateMatch({ ...project, aiAnalysis: { unmappedSkillNames: ["Java"] } }, ["a", "b", "c"]).matchPercentage, null);
});

test("skill resolution handles aliases and preserves unknown requirements", () => {
  assert.deepEqual(resolveSkills(["NodeJS", "node.js", "Postgres", "Unknown"], [
    { _id: "1", name: "Node.js" }, { _id: "2", name: "PostgreSQL" },
  ]), { requiredSkills: ["1", "2"], unmappedSkillNames: ["Unknown"] });
});

test("rejects missing TOR content, malformed skills, and invalid JSON shapes", () => {
  for (const value of [null, {}, { hasTorContent: false, descriptions: "announcement", mandatorySkills: [] },
    { hasTorContent: true, descriptions: "TOR", mandatorySkills: [123] }]) {
    assert.throws(() => validateAnalysis(value));
  }
  const skillEvidence = [{ name: "Java", quote: "Must maintain the Java application", page: 1, documentIndex: 1 }];
  assert.deepEqual(validateAnalysis({ hasTorContent: true, descriptions: " TOR ", mandatorySkills: ["Java", "Java"], skillEvidence, noMandatorySkillsReason: "" }),
    { descriptions: "TOR", mandatorySkills: ["Java"], skillEvidence, noMandatorySkillsReason: "" });
});

test("source allowlist rejects local services, credentials and non-HTTPS URLs", () => {
  for (const url of ["http://egp2.bangkok.go.th", "https://127.0.0.1", "https://metadata.google.internal", "https://egp2.bangkok.go.th.evil.test", "https://user:pass@egp2.bangkok.go.th", "https://egp2.bangkok.go.th:8443"]) {
    assert.throws(() => checkedUrl(url));
  }
  assert.equal(attachmentUrl("abc", "tor file.pdf"), "https://egp2.bangkok.go.th/api/file/abc/tor%20file.pdf");
});

test("e-GP resolver reads TOR API then downloads real PDF bytes", async t => {
  const calls = [];
  t.mock.method(global, "fetch", async url => {
    calls.push(String(url));
    if (String(url).includes("GetTorInProject")) return new Response(JSON.stringify({ data: [{ projectTorId: "doc", projectTorPath: "tor.pdf" }] }));
    return new Response("%PDF-1.7 fixture");
  });
  const documents = await loadTor("https://egp2.bangkok.go.th/project-detail/project");
  assert.match(calls[0], /projectId=project/);
  assert.equal(documents[0].url, "https://egp2.bangkok.go.th/api/file/doc/tor.pdf");
});

test("resolver refuses redirects to private endpoints and HTML without PDFs", async t => {
  const mock = t.mock.method(global, "fetch", async () => new Response(null, { status: 302, headers: { location: "https://127.0.0.1/secret" } }));
  await assert.rejects(loadTor("https://egp2.bangkok.go.th/tor.pdf"), /configured/);
  mock.mock.mockImplementation(async () => new Response("<html>login</html>"));
  await assert.rejects(loadTor("https://egp2.bangkok.go.th/tor.pdf"), /without a PDF/);
});

function workerFixture() {
  const writes = [];
  return { writes, projects: {
    findOneAndUpdate: async (query, patch) => {
      assert.deepEqual(query.$or[0], { analysisStatus: "pending" });
      return { _id: "project", sourceUrl: "https://egp2.bangkok.go.th/tor.pdf", analysisLease: patch.$set.analysisLease };
    },
    updateOne: async (query, patch) => { assert.ok(query.analysisLease); writes.push(patch); },
  }, skills: { find: () => ({ select: () => ({ lean: async () => [{ _id: "skill", name: "Java" }] }) }) } };
}

test("worker persists summary, resolved IDs and document provenance", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => [{ url: "https://egp2.bangkok.go.th/tor.pdf" }],
    analyze: async () => ({ descriptions: "สรุป TOR", mandatorySkills: ["Java", "Unknown"] }) });
  const result = fixture.writes[0].$set;
  assert.equal(result.analysisStatus, "completed");
  assert.equal(result.descriptions, "สรุป TOR");
  assert.deepEqual(result.requiredSkills, ["skill"]);
  assert.deepEqual(result.aiAnalysis.unmappedSkillNames, ["Unknown"]);
});

test("source failures record failed state without overwriting existing analysis", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => { throw new Error("No TOR"); }, analyze: async () => assert.fail("must not call AI") });
  assert.equal(fixture.writes[0].$set.analysisStatus, "failed");
  assert.equal(fixture.writes[0].$set.descriptions, undefined);
});

test("idle worker never calls Vertex AI", async () => {
  assert.equal(await processNext({ projects: { findOneAndUpdate: async () => null }, analyze: async () => assert.fail() }), false);
});

test("v2 extraction requires evidence for names and explanation for empty skills", () => {
  const value = { hasTorContent: true, descriptions: "TOR", mandatorySkills: ["Java"], skillEvidence: [], noMandatorySkillsReason: "" };
  assert.throws(() => validateAnalysis(value), /needs a TOR quote/);
  assert.throws(() => validateAnalysis({ ...value, mandatorySkills: [] }), /require an explanation/);
  assert.equal(validateAnalysis({ ...value, mandatorySkills: [], noMandatorySkillsReason: "Only licenses are purchased" }).mandatorySkills.length, 0);
  assert.throws(() => validateAnalysis({ ...value, skillEvidence: [{ name: "Java", quote: "Required Java", page: 1, documentIndex: 2 }] }, 1), /needs a TOR quote/);
});

test("creates missing skills with evidence and reuses IDs without duplicate creation", async () => {
  const vocabulary = [{ _id: "java", name: "Java" }];
  const created = [];
  const model = { findOne: async () => null, create: async data => { created.push(data); return { ...data, _id: "backup" }; } };
  const analysis = { mandatorySkills: ["Java", "Database Backup", "Unproven"], skillEvidence: [{ name: "Database Backup", quote: "Perform daily database backups" }] };
  const mapped = await ensureRequiredSkills(analysis, vocabulary, model);
  assert.deepEqual(mapped, { requiredSkills: ["java", "backup"], unmappedSkillNames: ["Unproven"] });
  await ensureRequiredSkills(analysis, vocabulary, model);
  assert.equal(created.length, 1);
});

test("error classification separates missing documents, invalid output, and transient failures", () => {
  assert.equal(classifyAnalysisError(analysisError("NO_TOR_DOCUMENT", "missing")).status, "awaiting_documents");
  assert.equal(classifyAnalysisError(analysisError("DOCUMENT_LIMIT", "large")).status, "needs_review");
  assert.equal(classifyAnalysisError(new Error('{"error":{"code":429}}')).retryable, true);
  assert.equal(classifyAnalysisError(Object.assign(new Error("Denied"), { status: 403 })).retryable, false);
});

test("worker defers 429 retries and stops after three scheduled retries", async () => {
  for (const count of [0, 3]) {
    const fixture = workerFixture();
    const claim = fixture.projects.findOneAndUpdate;
    fixture.projects.findOneAndUpdate = async (...args) => ({ ...await claim(...args), analysisRetryCount: count });
    await processNext({ ...fixture, load: async () => { throw Object.assign(new Error("Rate limited"), { status: 429 }); } });
    const patch = fixture.writes[0].$set;
    assert.equal(patch.analysisStatus, count === 0 ? "retry_pending" : "failed");
    if (!count) assert.ok(patch.nextAnalysisAt.getTime() > Date.now() + 50000);
  }
});

test("worker records missing TOR separately without calling AI", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => { throw analysisError("NO_TOR_DOCUMENT", "No PDF"); }, analyze: async () => assert.fail() });
  assert.equal(fixture.writes[0].$set.analysisStatus, "awaiting_documents");
  assert.equal(fixture.writes[0].$set.analysisErrorCode, "NO_TOR_DOCUMENT");
});
