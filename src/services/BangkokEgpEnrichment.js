const Project = require("../models/Project");
const IngestionLog = require("../models/IngestionLog");
const {
  fetchProjectDetail,
  fetchAnnouncements,
  fetchTors,
  deriveProcurementStatus,
  toTorDocuments,
  verifyPdfUrl,
} = require("./BangkokEgpDetailClient");

const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_TOR_DOCS = 5;

const needsEnrichment = (now = new Date()) => ({
  source: "bangkok-egp",
  $or: [
    { sourceVerifiedAt: null },
    { sourceVerifiedAt: { $lt: new Date(now.getTime() - STALE_MS) } },
  ],
});

const enrichOne = async (project, deps) => {
  const [detail, announcements, tors] = await Promise.all([
    deps.detail(project.externalId),
    deps.announcements(project.externalId),
    deps.tors(project.externalId),
  ]);

  const documents = [];
  const candidates = [...toTorDocuments(announcements), ...tors];
  for (const doc of candidates.filter((d, i) => candidates.findIndex(other => other.url === d.url) === i).slice(0, MAX_TOR_DOCS)) {
    if (await deps.verify(doc.url)) {
      documents.push({ title: doc.title, url: doc.url, kind: "tor", verifiedAt: new Date() });
    }
  }

  const update = {
    procurementStatus: deriveProcurementStatus(announcements),
    sourceVerifiedAt: new Date(),
    dataVerified: documents.length > 0,
    documents,
  };
  const priorUrls = (project.documents || []).map(doc => doc.url).sort();
  const currentUrls = documents.map(doc => doc.url).sort();
  if (documents.length && JSON.stringify(priorUrls) !== JSON.stringify(currentUrls) &&
    ["awaiting_documents", "failed"].includes(project.analysisStatus)) {
    update.analysisStatus = "pending";
    update.analysisError = "";
    update.analysisErrorCode = "";
  }
  if (detail.procurementMethod) update.procurementMethod = detail.procurementMethod;
  if (detail.sourceStatus) update.sourceStatus = detail.sourceStatus;
  if (detail.referencePrice !== undefined) update.referencePrice = detail.referencePrice;

  await deps.projects.updateOne({ _id: project._id }, { $set: update });
};

const enrichBangkokProjects = async ({
  batchSize = 50,
  projects = Project,
  logs = IngestionLog,
  detail = fetchProjectDetail,
  announcements = fetchAnnouncements,
  tors = fetchTors,
  verify = verifyPdfUrl,
  now = new Date(),
} = {}) => {
  const startedAt = new Date();
  const candidates = await projects
    .find(needsEnrichment(now))
    .sort({ createdAt: -1 })
    .limit(batchSize)
    .select("_id externalId documents analysisStatus");

  const counters = { enriched: 0, failed: 0 };
  for (const project of candidates) {
    try {
      await enrichOne(project, { projects, detail, announcements, tors, verify });
      counters.enriched += 1;
    } catch (error) {
      counters.failed += 1;
      console.error(`Bangkok enrichment failed for ${project.externalId}:`, error.message);
    }
  }

  if (candidates.length) {
    await logs.create({
      source: "bangkok-egp",
      status: counters.failed > 0 && counters.enriched === 0 ? "Failed" : "Success",
      torsIngested: 0,
      projectsUpdated: counters.enriched,
      projectsFailed: counters.failed,
      filterUsed: { stage: "enrichment", batchSize },
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }).catch((error) => console.error("Cannot save enrichment log:", error.message));
  }

  return { scanned: candidates.length, ...counters };
};

module.exports = { enrichBangkokProjects, needsEnrichment };
