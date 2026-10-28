// Preview first. The plan records the exact IDs and previous queue fields.
require("dotenv").config({ quiet: true });
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const { planAnalysisBatch } = require("../src/services/AnalysisQueuePolicy");

async function main() {
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  const apply = args.includes("--apply");
  const planPath = path.resolve(args.includes("--plan") ? value("--plan") : "tmp/recent-analysis-plan.json");
  if (String(process.env.VERTEX_AI_ENABLED).trim().toLowerCase() === "true") {
    throw new Error("Disable Vertex and recreate the backend before changing the queue");
  }
  await mongoose.connect(process.env.MONGO_URI);
  let plan;
  if (!apply) {
    const limit = args.includes("--limit") ? Number(value("--limit")) : 20;
    const projects = await Project.find().select("title createdAt sourceUrl status procurementStatus deadline deadlinePrecision analysisStatus analysisAutoEligible analysisSkipReason analysisHold analysisError analysisErrorCode analysisRetryCount nextAnalysisAt analysisLease analysisLeaseUntil").lean();
    if (projects.some(p => p.analysisStatus === "processing" && new Date(p.analysisLeaseUntil) > new Date())) {
      throw new Error("An active analysis lease exists; wait for it to finish or expire before planning");
    }
    plan = { version: 1, createdAt: new Date().toISOString(), limit, entries: planAnalysisBatch(projects, limit) };
    fs.mkdirSync(path.dirname(planPath), { recursive: true });
    fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), { flag: "wx" });
  } else {
    plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
    if (plan.version !== 1 || !Array.isArray(plan.entries) || !plan.entries.length) throw new Error("Invalid plan");
    const writes = plan.entries.map(entry => {
      const unset = entry.set.analysisStatus ? { nextAnalysisAt: 1, analysisLease: 1, analysisLeaseUntil: 1 } : null;
      return { updateOne: { filter: { _id: entry.id, analysisStatus: entry.before.analysisStatus, sourceUrl: entry.before.sourceUrl },
        update: { $set: entry.set, ...(unset ? { $unset: unset } : {}) } } };
    });
    const result = await Project.bulkWrite(writes, { ordered: true });
    console.log(JSON.stringify({ applied: true, matched: result.matchedCount, modified: result.modifiedCount, planned: writes.length }));
    if (result.matchedCount !== writes.length) throw new Error("Some records changed since preview. Inspect current queue before continuing; matched records were updated");
  }
  const counts = {};
  for (const entry of plan.entries) {
    const status = entry.set.analysisStatus || entry.before.analysisStatus;
    counts[status] = (counts[status] || 0) + 1;
  }
  console.log(JSON.stringify({ planPath, applied: apply, total: plan.entries.length, projectedStatuses: counts,
    selected: plan.entries.filter(e => e.selected).map(e => ({ id: e.id, title: e.title, before: e.before.analysisStatus,
      after: e.set.analysisStatus || e.before.analysisStatus, reason: e.set.analysisSkipReason })) }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
