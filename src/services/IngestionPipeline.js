const Project = require("../models/Project");
const IngestionLog = require("../models/IngestionLog");
const {
  FILTER_VERSION,
  classifySoftware,
} = require("./SoftwareKeywordClassifier");

const normalizeStatus = (record) => {
  const value = String(record.status || record.sourceStatus || "")
    .trim()
    .toLowerCase();

  if (["draft", "ร่าง", "อยู่ระหว่างร่าง"].includes(value)) return "Draft";
  return "Public";
};

const toProjectDocument = (record, source, sourceUrl, classification) => ({
  title: String(record.title || "").trim(),
  agency: record.agency,
  description: record.description || record.scope || "",
  budget: record.budget,
  category: record.category || "Software",
  status: normalizeStatus(record),
  sourceUrl: record.sourceUrl || sourceUrl,
  source,
  externalId: String(record.externalId || record.id || "").trim(),
  sourceStatus: record.sourceStatus || record.status,
  classification: "software",
  classificationMethod: `keyword:${FILTER_VERSION}`,
  matchedKeywords: classification.matchedKeywords,
  deadline: record.deadline,
  lastScrapedAt: new Date(),
  rawData: record.rawData || null,
  publisherId: null,
});

const ingestRecords = async ({
  records,
  source,
  sourceUrl,
  budgetYear,
  filterUsed = { language: ["th", "en"], category: "software" },
}) => {
  const startedAt = new Date();
  const counters = {
    projectsCreated: 0,
    projectsUpdated: 0,
    projectsSkipped: 0,
    projectsFiltered: 0,
    projectsFailed: 0,
  };

  for (const record of records || []) {
    try {
      const classification = classifySoftware(record);
      if (!classification.isSoftware) {
        counters.projectsFiltered += 1;
        continue;
      }

      const project = toProjectDocument(record, source, sourceUrl, classification);
      if (!project.title || !project.externalId) {
        counters.projectsSkipped += 1;
        continue;
      }

      const existing = await Project.findOne({
        source: project.source,
        externalId: project.externalId,
      }).select("_id");

      if (existing) {
        await Project.findByIdAndUpdate(existing._id, {
          $set: project,
          $setOnInsert: { publisherId: null },
        }, { runValidators: true });
        counters.projectsUpdated += 1;
      } else {
        await Project.create(project);
        counters.projectsCreated += 1;
      }
    } catch (error) {
      counters.projectsFailed += 1;
      console.error("Ingestion record error:", error);
    }
  }

  const finishedAt = new Date();
  return IngestionLog.create({
    source,
    sourceUrl,
    status: counters.projectsFailed === (records || []).length && records?.length
      ? "Failed"
      : "Success",
    torsIngested: counters.projectsCreated + counters.projectsUpdated,
    ...counters,
    budgetYear,
    filterUsed,
    filterVersion: FILTER_VERSION,
    startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  });
};

module.exports = {
  ingestRecords,
  normalizeStatus,
  toProjectDocument,
};
