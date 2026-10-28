const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL = ["closed", "awarded", "cancelled", "draft"];
const bangkokDayStart = now => new Date(Math.floor((now.getTime() + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000);

function availability(project, now = new Date()) {
  if (project.status === "Draft") return "draft";
  if (TERMINAL.includes(project.procurementStatus)) return project.procurementStatus;
  if (project.deadline && Number.isNaN(new Date(project.deadline).getTime())) return "unverified";
  if (project.deadline && (project.deadlinePrecision === "datetime"
    ? new Date(project.deadline) <= now
    : new Date(project.deadline) < bangkokDayStart(now))) return "closed";
  const verified = new Date(project.sourceVerifiedAt).getTime();
  if (!project.dataVerified || !Number.isFinite(verified) || verified < now.getTime() - MAX_AGE_MS) return "unverified";
  if (!project.deadline || project.procurementStatus !== "open") return "unknown";
  return "open";
}

const ALLOWED_SOURCES = [
  "bangkok-egp",
  "egat-bidding",
  "ieat-procurement",
  "gistda-procurement",
  "tero-procurement",
  "govspending",
];

function publicProjectQuery(now = new Date()) {
  const base = {
    status: "Public", dataVerified: true,
    source: { $in: ALLOWED_SOURCES }, classification: "software",
    sourceVerifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
    documents: { $elemMatch: { kind: "tor", url: { $regex: "^https://" }, verifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) } } },
    analysisStatus: "completed",
    title: { $regex: "\\S" },
    descriptions: { $regex: "\\S" },
    budget: { $type: "number", $gt: 0 },
    announcedAt: { $type: "date" },
    "aiAnalysis.fieldResults.budget.status": "found",
    "aiAnalysis.fieldResults.announcedAt.status": "found",
    "aiAnalysis.fieldResults.deadline.status": "found",
  };
  const open = { procurementStatus: "open", $or: [
    { deadlinePrecision: "datetime", deadline: { $gt: now } },
    { deadlinePrecision: { $ne: "datetime" }, deadline: { $gte: bangkokDayStart(now) } },
  ] };
  // Keep eligibility separate from text search and optional date bounds.
  return { ...base, procurementStatus: "open", $and: [open] };
}

// Drafts are never analyzed (bids are not open yet), so they cannot meet the
// open feed's extraction rules; requiring a recent listing keeps stale drafts out.
function draftProjectQuery(now = new Date()) {
  return {
    source: { $in: ALLOWED_SOURCES }, classification: "software",
    title: { $regex: "\\S" },
    lastScrapedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
    $and: [{ $or: [{ status: "Draft" }, { procurementStatus: "draft" }] }],
  };
}

module.exports = { availability, publicProjectQuery, draftProjectQuery, MAX_AGE_MS, ALLOWED_SOURCES };
