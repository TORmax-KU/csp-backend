const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TERMINAL = ["closed", "awarded", "cancelled", "draft"];

function availability(project, now = new Date()) {
  if (TERMINAL.includes(project.procurementStatus)) return project.procurementStatus;
  if (project.deadline && Number.isNaN(new Date(project.deadline).getTime())) return "unverified";
  if (project.deadline && new Date(project.deadline) <= now) return "closed";
  const verified = new Date(project.sourceVerifiedAt).getTime();
  if (!project.dataVerified || !Number.isFinite(verified) || verified < now.getTime() - MAX_AGE_MS) return "unverified";
  if (!project.deadline || project.procurementStatus !== "open") return "unknown";
  return "open";
}

function publicProjectQuery(now = new Date(), mode = "open") {
  const base = {
    status: "Public", dataVerified: true,
    source: { $in: ["gprocurement", "bangkok-egp"] }, classification: "software",
    sourceVerifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) },
    documents: { $elemMatch: { kind: "tor", url: { $regex: "^https://" }, verifiedAt: { $gte: new Date(now.getTime() - MAX_AGE_MS) } } },
  };
  if (mode === "unknown") return { ...base, procurementStatus: { $in: ["open", "unknown"] }, deadline: null };
  return { ...base, procurementStatus: "open", deadline: { $gt: now } };
}

module.exports = { availability, publicProjectQuery, MAX_AGE_MS };
