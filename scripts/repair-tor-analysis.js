require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const { classifyAnalysisError, analysisError } = require("../src/services/AnalysisErrors");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const apply = process.argv.includes("--apply");
  const counts = {};
  for (const project of await Project.find({ analysisStatus: "failed" }).lean()) {
    const message = project.analysisError || "";
    let code;
    if (message === "No public TOR attachment found at sourceUrl") code = "NO_TOR_DOCUMENT";
    else if (/exceed.*(limits|MiB)/i.test(message)) code = "DOCUMENT_LIMIT";
    else if (message === "AI response did not contain valid TOR content and skills") code = "INVALID_AI_RESPONSE";
    const result = classifyAnalysisError(analysisError(code, message));
    // Do not automatically re-call old failures or guess which v1 validation failed.
    const status = result.retryable ? "failed" : result.status;
    counts[status] = (counts[status] || 0) + 1;
    if (apply) await Project.updateOne({ _id: project._id, analysisStatus: "failed", analysisError: message },
      { $set: { analysisStatus: status, analysisErrorCode: result.code } });
  }
  console.log(JSON.stringify({ applied: apply, reclassified: counts }));
  const index = process.argv.indexOf("--reanalyze");
  if (index !== -1) {
    const id = process.argv[index + 1];
    if (!mongoose.isValidObjectId(id)) throw new Error("--reanalyze requires a valid project ID");
    if (!apply) { console.log(`Would queue ${id}`); return; }
    const result = await Project.updateOne({ _id: id, analysisStatus: { $nin: ["processing", "pending", "retry_pending"] } },
      { $set: { analysisStatus: "pending", analysisError: "", analysisErrorCode: "", analysisRetryCount: 0 },
        $unset: { nextAnalysisAt: 1 } });
    console.log(`Queued ${result.modifiedCount} project(s)`);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
