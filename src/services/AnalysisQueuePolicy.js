const TERMINAL = ["closed", "awarded", "cancelled", "draft"];
const { detailTerminalStatus } = require("./BangkokEgpDocumentMetadata");

function analysisSkipReason(project, now = new Date()) {
  if (project.status === "Draft") return "Project is a draft";
  if (TERMINAL.includes(project.procurementStatus)) return `Procurement is ${project.procurementStatus}`;
  if (['tero-procurement', 'govspending'].includes(project.source) && !/e-bidding/i.test(project.procurementMethod || '')) return 'Outside the public e-bidding feed';
  const sourceTerminal = project.source === "bangkok-egp" && detailTerminalStatus(project);
  if (sourceTerminal) return `Official source is ${sourceTerminal}`;
  if (project.deadline) {
    const deadline = new Date(project.deadline).getTime();
    const bangkokDayStart = Math.floor((now.getTime() + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000;
    if (!Number.isFinite(deadline)) return "Deadline is invalid; source review required";
    if (project.deadlinePrecision === "datetime" ? deadline <= now.getTime() : deadline < bangkokDayStart) {
      return "Bid deadline has passed";
    }
  }
  return "";
}

function planAnalysisBatch(projects, limit = 20, now = new Date()) {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Limit must be a positive integer");
  const sorted = [...projects].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt) || String(b._id).localeCompare(String(a._id)));
  const selected = new Set(sorted.slice(0, limit).map(p => String(p._id)));
  return sorted.map(p => {
    const recent = selected.has(String(p._id));
    const reason = analysisSkipReason(p, now);
    const set = { analysisAutoEligible: recent && !reason, analysisSkipReason: recent ? reason : "Outside selected newest-project batch; manual retry available" };
    // Completed output is retained regardless of age or deadline.
    if (p.analysisStatus !== "completed") {
      if (recent && !reason) Object.assign(set, { analysisStatus: "pending", analysisHold: false, analysisSkipReason: "", analysisError: "", analysisErrorCode: "", analysisRetryCount: 0 });
      else if (recent || ["pending", "retry_pending", "processing"].includes(p.analysisStatus)) set.analysisStatus = "skipped";
    }
    return { id: String(p._id), title: p.title, selected: recent, before: p, set };
  });
}

module.exports = { analysisSkipReason, planAnalysisBatch };
