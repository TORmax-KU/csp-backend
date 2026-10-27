const assert = require("node:assert/strict");
const fs = require("node:fs");
const { analyzeTor } = require("../src/services/VertexTorAnalyzer");
const { classifyAnalysisError } = require("../src/services/AnalysisErrors");
process.env.GOOGLE_CLOUD_PROJECT = "test-project";
process.env.VERTEX_MODEL = "test-model";
process.env.GOOGLE_CLOUD_LOCATION = "global";
const baseUrl = process.env.VERTEX_SIMULATION_URL || "http://host.docker.internal:4900/vertex";
const documents = [{ url: "fixture.pdf", bytes: fs.readFileSync(process.argv[2] || "tmp/pdfs/pbis-0.pdf") }];
delete process.env.GOOGLE_API_KEY;
delete process.env.GEMINI_API_KEY;
const { OAuth2Client } = require("google-auth-library");
const authClient = new OAuth2Client();
authClient.setCredentials({ access_token: "local-simulation-only", expiry_date: Date.now() + 3600000 });
const clientOptions = { googleAuthOptions: { authClient },
  httpOptions: { baseUrl, apiVersion: "v1beta1", timeout: 10000, headers: { Authorization: "Bearer local-simulation-only" }, retryOptions: { attempts: 1 } } };
async function main() {
  const result = await analyzeTor(documents, [], {}, { clientOptions });
  assert.equal(result.metadata.values.budget, 2330000);
  assert.equal(result.metadata.values.deadline, null);
  assert.equal(result.metadata.fields.deadline.status, "not_found");
  const failureOptions = { ...clientOptions, httpOptions: { ...clientOptions.httpOptions, headers: { ...clientOptions.httpOptions.headers, "x-test-error": "429" } } };
  await assert.rejects(analyzeTor(documents, [], {}, { clientOptions: failureOptions }), error => classifyAnalysisError(error).retryable === true);
  // Isolated local MongoDB: never use the shared Atlas MONGO_URI for fixtures.
  const mongoose = require("mongoose");
  const connection = await mongoose.createConnection(`mongodb://mongo:27017/tor_vertex_test_${Date.now()}`).asPromise();
  try {
    const { ProjectSchema } = require("../schemas/ProjectModel");
    const projects = connection.model("VertexTestProject", ProjectSchema);
    const skills = connection.model("VertexTestSkill", new mongoose.Schema({ name: String }));
    const project = await projects.create({ title: "Isolated Vertex integration fixture", sourceUrl: "https://egp2.bangkok.go.th/test.pdf", analysisHold: false });
    const { processNext } = require("../src/services/TorAnalysisWorker");
    await processNext({ projects, skills, load: async () => documents, analyze: (docs, names, context) => analyzeTor(docs, names, context, { clientOptions }) });
    const saved = await projects.findById(project._id).lean();
    assert.equal(saved.analysisStatus, "completed");
    assert.equal(saved.budget, 2330000);
    assert.equal(saved.deadline, null);
    assert.equal(saved.aiAnalysis.fieldResults.budget.evidence.page, 6);
    assert.equal(saved.aiAnalysis.fieldResults.deadline.status, "not_found");
    assert.equal(saved.procurementStatus, "unknown");
    assert.ok(saved.descriptions);
    console.log("Worker persistence passed against isolated local MongoDB; Atlas was not used.");
  } finally { await connection.dropDatabase(); await connection.close(); }
  console.log("Vertex SDK HTTP simulation passed: request schema, PDF upload, result parsing and 429 classification.");
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
