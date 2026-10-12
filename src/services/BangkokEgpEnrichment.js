const Project = require("../models/Project");
const IngestionLog = require("../models/IngestionLog");
const {
  fetchProjectDetail,
  fetchAnnouncements,
  deriveProcurementStatus,
  toTorDocuments,
  verifyPdfUrl,
} = require("./BangkokEgpDetailClient");

const STALE_MS = 24 * 60 * 60 * 1000;
const MAX_TOR_DOCS = 5;

const needsEnrichment = (now = new Date()) => ({
  source: "bangkok-egp",
  $or: [
    { dataVerified: false },
    { sourceVerifiedAt: null },
    { sourceVerifiedAt: { $lt: new Date(now.getTime() - STALE_MS) } },
    { procurementStatus: "unknown" },
  ],
});

const enrichOne = async (project, deps) => {
  const [detail, announcements] = await Promise.all([
    deps.detail(project.externalId),
    deps.announcements(project.externalId),
  ]);

  const documents = [];
  for (const doc of toTorDocuments(announcements).slice(0, MAX_TOR_DOCS)) {
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
  verify = verifyPdfUrl,
  now = new Date(),
} = {}) => {
  const startedAt = new Date();
  const candidates = await projects
    .find(needsEnrichment(now))
    .sort({ lastScrapedAt: 1 })
    .limit(batchSize)
    .select("_id externalId");

  const counters = { enriched: 0, failed: 0 };
  for (const project of candidates) {
    try {
      await enrichOne(project, { projects, detail, announcements, verify });
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
