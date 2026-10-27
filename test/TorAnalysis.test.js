const test = require("node:test");
const assert = require("node:assert/strict");
const { calculateMatch, resolveSkills, ensureRequiredSkills } = require("../src/services/SkillMatching");
const { analysisError, classifyAnalysisError } = require("../src/services/AnalysisErrors");
const { validateAnalysis: validateV3 } = require("../src/services/VertexTorAnalyzer");
const { metadata } = require("./fixtures/tor-v3");
const validateAnalysis = (value, count) => validateV3(value && { ...value, metadata: metadata() }, count);
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
    { hasTorContent: true, descriptions: "TOR", mandatorySkills: ["Java"], skillEvidence, noMandatorySkillsReason: "", metadata: require("../src/services/TorMetadata").validateMetadata(metadata(), 5) });
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
    if (String(url).includes("GetAnnouncementDetailInProject")) return new Response(JSON.stringify({ data: [] }));
    if (String(url).includes("GetTorInProject")) return new Response(JSON.stringify({ data: [{ projectTorId: "doc", projectTorPath: "tor.pdf" }] }));
    return new Response("%PDF-1.7 fixture");
  });
  const documents = await loadTor("https://egp2.bangkok.go.th/project-detail/project");
  assert.match(calls[0], /projectId=project/);
  assert.equal(documents[0].url, "https://egp2.bangkok.go.th/api/file/doc/tor.pdf");
});

test("e-GP resolver includes the final invitation before draft TOR documents", async t => {
  t.mock.method(global, "fetch", async url => {
    const value = String(url);
    if (value.includes("GetTorInProject")) return new Response(JSON.stringify({ data: [] }));
    if (value.includes("GetAnnouncementDetailInProject")) return new Response(JSON.stringify({ data: [
      { id: "draft", masterAnnounceTypeName: "ร่างขอบเขตของงาน (TOR)", projectAnnouncementPath: "draft.pdf", projectAnnouncementPublishDate: "2026-09-01" },
      { id: "invite", masterAnnounceTypeName: "ประกาศเชิญชวน", projectAnnouncementPath: "invite.pdf", projectAnnouncementPublishDate: "2026-10-01" },
    ] }));
    return new Response("%PDF-1.7 fixture");
  });
  const documents = await loadTor("https://egp2.bangkok.go.th/project-detail/project");
  assert.match(documents[0].url, /invite\/invite\.pdf$/);
  assert.match(documents[1].url, /draft\/draft\.pdf$/);
});

test("resolver keeps the first PDFs within the combined Vertex size limit", async t => {
  const bytes = Buffer.alloc(8 * 1024 * 1024);
  bytes.write("%PDF-");
  t.mock.method(global, "fetch", async () => new Response(bytes));
  const documents = await loadTor("https://egp2.bangkok.go.th/source", [
    { kind: "tor", url: "https://egp2.bangkok.go.th/one.pdf" },
    { kind: "tor", url: "https://egp2.bangkok.go.th/two.pdf" },
    { kind: "tor", url: "https://egp2.bangkok.go.th/three.pdf" },
  ]);
  assert.equal(documents.length, 2);
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
    updateOne: async (query, patch) => { assert.ok(query.analysisLease || query.analyzedAt); writes.push(patch); },
  }, skills: { find: () => ({ select: () => ({ lean: async () => [{ _id: "skill", name: "Java" }] }) }) } };
}

test("worker persists summary, resolved IDs and document provenance", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => [{ url: "https://egp2.bangkok.go.th/tor.pdf" }],
    analyze: async () => ({ hasTorContent: true, descriptions: "สรุป TOR", mandatorySkills: ["Java", "Unknown"], metadata: {
      values: { budget: 1000000, announcedAt: "2026-10-01", deadline: "2026-11-01T12:00:00+07:00", deadlinePrecision: "datetime" },
      fields: { budget: { status: "found" }, announcedAt: { status: "found" }, deadline: { status: "found" } }, needsReview: false,
    } }) });
  const result = fixture.writes[0].$set;
  assert.equal(result.analysisStatus, "completed");
  assert.equal(result.descriptions, "สรุป TOR");
  assert.equal(result.budget, 1000000);
  assert.equal(result.announcedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(result.deadline.toISOString(), "2026-11-01T05:00:00.000Z");
  assert.deepEqual(result.requiredSkills, ["skill"]);
  assert.deepEqual(result.aiAnalysis.unmappedSkillNames, ["Unknown"]);
});

test("worker marks an analyzed TOR with missing required fields for review", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => [{ url: "https://egp2.bangkok.go.th/tor.pdf" }],
    analyze: async () => ({ hasTorContent: true, descriptions: "สรุป TOR", mandatorySkills: [],
      metadata: require("../src/services/TorMetadata").validateMetadata(metadata(), 1) }) });
  assert.equal(fixture.writes[0].$set.analysisStatus, "needs_review");
  assert.equal(fixture.writes[0].$set.budget, null);
  assert.equal(fixture.writes[0].$set.deadline, null);
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

test("worker keeps retrying temporary 429 errors with capped backoff", async () => {
  for (const count of [0, 3, 20]) {
    const fixture = workerFixture();
    const claim = fixture.projects.findOneAndUpdate;
    fixture.projects.findOneAndUpdate = async (...args) => ({ ...await claim(...args), analysisRetryCount: count });
    await processNext({ ...fixture, load: async () => { throw Object.assign(new Error("Rate limited"), { status: 429 }); } });
    const patch = fixture.writes[0].$set;
    assert.equal(patch.analysisStatus, "retry_pending");
    assert.equal(patch.analysisRetryCount, count + 1);
    assert.ok(patch.nextAnalysisAt.getTime() > Date.now() + 50000);
    assert.ok(patch.nextAnalysisAt.getTime() < Date.now() + 31 * 60000);
  }
});

test("worker records missing TOR separately without calling AI", async () => {
  const fixture = workerFixture();
  await processNext({ ...fixture, load: async () => { throw analysisError("NO_TOR_DOCUMENT", "No PDF"); }, analyze: async () => assert.fail() });
  assert.equal(fixture.writes[0].$set.analysisStatus, "awaiting_documents");
  assert.equal(fixture.writes[0].$set.analysisErrorCode, "NO_TOR_DOCUMENT");
});
