const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL = ["closed", "awarded", "cancelled", "draft"];
const bangkokDayStart = now => new Date(Math.floor((now.getTime() + 7 * 3600000) / 86400000) * 86400000 - 7 * 3600000);

function availability(project, now = new Date()) {
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
  "gprocurement",
  "bangkok-egp",
  "egat-bidding",
  "ieat-procurement",
  "gistda-procurement",
];

function publicProjectQuery(now = new Date(), mode = "open") {
  const base = {
    status: "Public", dataVerified: true,
    source: { $in: ALLOWED_SOURCES }, classification: "software",
    sourceVerifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
    documents: { $elemMatch: { kind: "tor", url: { $regex: "^https://" }, verifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) } } },
  };
  const open = { procurementStatus: "open", $or: [
    { deadlinePrecision: "datetime", deadline: { $gt: now } },
    { deadlinePrecision: { $ne: "datetime" }, deadline: { $gte: bangkokDayStart(now) } },
  ] };
  // Keep eligibility separate from text search and optional date bounds.
  if (mode === "all") return { ...base, $and: [{ $or: [
    open, { procurementStatus: { $in: ["open", "unknown"] }, deadline: null },
  ] }] };
  if (mode === "unknown") return { ...base, procurementStatus: { $in: ["open", "unknown"] }, deadline: null };
  return { ...base, procurementStatus: "open", $and: [open] };
}

module.exports = { availability, publicProjectQuery, MAX_AGE_MS, ALLOWED_SOURCES };
