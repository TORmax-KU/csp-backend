const { randomUUID } = require("node:crypto");
const Project = require("../models/Project");
const Skill = require("../models/Skill");
const { loadTor } = require("./TorSource");
const { analyzeTor, vertexConfig, PROMPT_VERSION } = require("./VertexTorAnalyzer");
const { ensureRequiredSkills } = require("./SkillMatching");
const { classifyAnalysisError } = require("./AnalysisErrors");

async function processNext({ projects = Project, skills = Skill, load = loadTor, analyze = analyzeTor, projectId } = {}) {
  const lease = randomUUID();
  const claim = { ...(projectId ? { _id: projectId } : {}), analysisHold: { $ne: true }, sourceUrl: { $type: "string", $ne: "" }, $or: [
    { analysisStatus: "pending" },
    { analysisStatus: "retry_pending", nextAnalysisAt: { $lte: new Date() } },
    { analysisStatus: "processing", analysisLeaseUntil: { $lt: new Date() } },
  ] };
  const project = await projects.findOneAndUpdate(claim, { $set: { analysisStatus: "processing", analysisLease: lease, analysisLeaseUntil: new Date(Date.now() + 15 * 60000), analysisError: "" },
    $inc: { analysisAttempts: 1 } }, { returnDocument: "after", sort: { createdAt: -1 } });
  if (!project) return false;
  const filter = { _id: project._id, analysisHold: { $ne: true }, analysisLease: lease, sourceUrl: project.sourceUrl };
  try {
    const documents = await load(project.sourceUrl, project.documents);
    const vocabulary = await skills.find({}).select("name").lean();
    const analysis = await analyze(documents, vocabulary.map(s => s.name), { title: project.title, externalId: project.externalId });
    const mapped = await ensureRequiredSkills(analysis, vocabulary, skills);
    const values = analysis.metadata.values;
    const analyzedAt = new Date();
    const requiredFieldsFound = ["budget", "announcedAt", "deadline"].every(name =>
      analysis.metadata.fields[name].status === "found" && values[name] !== null);
    const status = !analysis.hasTorContent ? "awaiting_documents" :
      analysis.metadata.needsReview || !requiredFieldsFound ? "needs_review" : "completed";
    await projects.updateOne(filter, { $set: {
      budget: values.budget,
      announcedAt: values.announcedAt ? new Date(values.announcedAt) : null,
      deadline: values.deadline ? new Date(values.deadline) : null,
      deadlinePrecision: values.deadlinePrecision,
      descriptions: analysis.descriptions, requiredSkills: mapped.requiredSkills,
      aiAnalysis: { mandatorySkillNames: analysis.mandatorySkills, unmappedSkillNames: mapped.unmappedSkillNames,
        documentUrls: documents.map(d => d.url), skillEvidence: analysis.skillEvidence || [],
        noMandatorySkillsReason: analysis.noMandatorySkillsReason || "", fieldResults: analysis.metadata.fields },
      analysisStatus: status, analyzedAt, aiModel: process.env.VERTEX_MODEL,
      aiPromptVersion: PROMPT_VERSION, analysisError: "", analysisErrorCode: "", analysisRetryCount: 0,
    }, $unset: { analysisLease: 1, analysisLeaseUntil: 1, nextAnalysisAt: 1 } });
    // A concurrent cancellation/award must never be reopened by AI.
    await projects.updateOne({ _id: project._id, analyzedAt, aiPromptVersion: PROMPT_VERSION,
      procurementStatus: { $nin: ["awarded", "cancelled", "draft"] } }, { $set: {
      procurementStatus: values.deadline ? "open" : "unknown",
    } });
    console.log(`TOR analysis ${status}: ${project._id}; budget=${analysis.metadata.fields.budget.status}, publication=${analysis.metadata.fields.announcedAt.status}, deadline=${analysis.metadata.fields.deadline.status}`);
  } catch (error) {
    const failure = classifyAnalysisError(error);
    const retries = project.analysisRetryCount || 0;
    const set = { analysisStatus: failure.retryable ? "retry_pending" : failure.status,
      analysisErrorCode: failure.code, analysisError: String(error.message).slice(0, 1000) };
    const unset = { analysisLease: 1, analysisLeaseUntil: 1 };
    if (failure.retryable) {
      set.analysisRetryCount = retries + 1;
      set.nextAnalysisAt = new Date(Date.now() + 60000 * Math.min(30, 2 ** Math.min(retries, 5)) + Math.floor(Math.random() * 15000));
    } else { unset.nextAnalysisAt = 1; }
    await projects.updateOne(filter, { $set: set, $unset: unset });
    console.error(`TOR analysis failed for ${project._id}: ${error.message}`);
    if ([401, 403, 404].includes(Number(error.status || error.code))) throw Object.assign(new Error("Vertex authentication, access or model configuration failed; worker paused. Check configuration and restart."), { pauseWorker: true });
  }
  return true;
}

async function prepareWorker({ projects = Project, authenticate } = {}) {
  if (!authenticate) authenticate = async () => {
    const { GoogleAuth } = require("google-auth-library");
    const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
    await auth.getAccessToken();
  };
  try { await authenticate(); } catch { throw Object.assign(new Error("Google ADC is unavailable. Mount the credential file with docker-compose.vertex.yaml, then restart."), { pauseWorker: true }); }
  return projects.updateMany({ analysisHold: true, analysisStatus: "pending" }, { $set: { analysisHold: false } });
}

function startTorAnalysisWorker() {
  if (String(process.env.VERTEX_AI_ENABLED).trim().toLowerCase() !== "true") return;
  try { vertexConfig(); } catch (error) { console.error(error.message); return; }
  let running = false;
  let initialized = false;
  let paused = false;
  const tick = async () => {
    if (running || paused) return;
    running = true;
    try {
      if (!initialized) {
        const released = await prepareWorker();
        console.log(`Vertex TOR worker ready (${PROMPT_VERSION}); released ${released.modifiedCount} pending TORs; one job at a time, checking every 10 seconds.`);
        initialized = true;
      }
      await processNext();
    } catch (error) { paused = !!error.pauseWorker; console.error("TOR worker:", error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 10000);
  timer.unref();
  void tick();
  return timer;
}
module.exports = { processNext, startTorAnalysisWorker, prepareWorker };
