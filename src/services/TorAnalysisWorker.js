const { randomUUID } = require("node:crypto");
const Project = require("../models/Project");
const Skill = require("../models/Skill");
const { loadTor } = require("./TorSource");
const { analyzeTor, vertexConfig, PROMPT_VERSION } = require("./VertexTorAnalyzer");
const { ensureRequiredSkills } = require("./SkillMatching");
const { classifyAnalysisError } = require("./AnalysisErrors");

async function processNext({ projects = Project, skills = Skill, load = loadTor, analyze = analyzeTor } = {}) {
  const lease = randomUUID();
  const project = await projects.findOneAndUpdate({ sourceUrl: { $type: "string", $ne: "" }, $or: [
    { analysisStatus: "pending" },
    { analysisStatus: "retry_pending", nextAnalysisAt: { $lte: new Date() } },
    { analysisStatus: "processing", analysisLeaseUntil: { $lt: new Date() } },
  ] }, { $set: { analysisStatus: "processing", analysisLease: lease, analysisLeaseUntil: new Date(Date.now() + 15 * 60000), analysisError: "" },
    $inc: { analysisAttempts: 1 } }, { returnDocument: "after", sort: { createdAt: 1 } });
  if (!project) return false;
  const filter = { _id: project._id, analysisLease: lease, sourceUrl: project.sourceUrl };
  try {
    const documents = await load(project.sourceUrl);
    const vocabulary = await skills.find({}).select("name").lean();
    const analysis = await analyze(documents, vocabulary.map(s => s.name));
    const mapped = await ensureRequiredSkills(analysis, vocabulary, skills);
    await projects.updateOne(filter, { $set: {
      descriptions: analysis.descriptions, requiredSkills: mapped.requiredSkills,
      aiAnalysis: { mandatorySkillNames: analysis.mandatorySkills, unmappedSkillNames: mapped.unmappedSkillNames,
        documentUrls: documents.map(d => d.url), skillEvidence: analysis.skillEvidence || [],
        noMandatorySkillsReason: analysis.noMandatorySkillsReason || "" },
      analysisStatus: "completed", analyzedAt: new Date(), aiModel: process.env.VERTEX_MODEL,
      aiPromptVersion: PROMPT_VERSION, analysisError: "", analysisErrorCode: "", analysisRetryCount: 0,
    }, $unset: { analysisLease: 1, analysisLeaseUntil: 1, nextAnalysisAt: 1 } });
  } catch (error) {
    const failure = classifyAnalysisError(error);
    const retries = project.analysisRetryCount || 0;
    const willRetry = failure.retryable && retries < 3;
    const set = { analysisStatus: failure.retryable ? (willRetry ? "retry_pending" : "failed") : failure.status,
      analysisErrorCode: failure.code, analysisError: String(error.message).slice(0, 1000) };
    const unset = { analysisLease: 1, analysisLeaseUntil: 1 };
    if (willRetry) {
      set.analysisRetryCount = retries + 1;
      set.nextAnalysisAt = new Date(Date.now() + 60000 * 2 ** retries + Math.floor(Math.random() * 15000));
    } else { unset.nextAnalysisAt = 1; }
    await projects.updateOne(filter, { $set: set, $unset: unset });
    console.error(`TOR analysis failed for ${project._id}: ${error.message}`);
  }
  return true;
}

function startTorAnalysisWorker() {
  if (String(process.env.VERTEX_AI_ENABLED).trim().toLowerCase() !== "true") return;
  try { vertexConfig(); } catch (error) { console.error(error.message); return; }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await processNext(); } catch (error) { console.error("TOR worker:", error.message); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 10000);
  timer.unref();
  void tick();
  return timer;
}
module.exports = { processNext, startTorAnalysisWorker };
