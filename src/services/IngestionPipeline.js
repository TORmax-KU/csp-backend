const Project = require("../models/Project");
const IngestionLog = require("../models/IngestionLog");
const { pendingTorExtraction } = require("./PendingTorExtraction");
const {
  FILTER_VERSION,
  classifySoftware,
} = require("./SoftwareKeywordClassifier");
const { DRAFT_SKIP_REASON, draftFields, leftDraftFields } = require("./DraftState");

const BANGKOK_SOURCE = "bangkok-egp";
// The listing's own publication date when it has one; otherwise when TORmax first saw the draft.
const draftDate = (project) => project.listingAnnouncedAt || new Date();

const normalizeStatus = (record) => {
  const value = String(record.status || record.sourceStatus || "")
    .trim()
    .toLowerCase();

  if (["draft", "ร่าง", "อยู่ระหว่างร่าง"].includes(value)) return "Draft";
  return "Public";
};

const toProjectDocument = (record, source, sourceUrl, classification) => {
  const finalSourceUrl = record.sourceUrl || sourceUrl;
  const now = new Date();
  const deadlineDate = record.deadline ? new Date(record.deadline) : null;
  const isFutureDeadline = deadlineDate && !Number.isNaN(deadlineDate.getTime()) && deadlineDate > now;
  const procurementStatus = isFutureDeadline ? "open" : (deadlineDate ? "closed" : "unknown");

  // A project detail page is a source link, not a verified TOR document.
  const documents = record.documents || [];

  return {
    title: String(record.title || "").trim(),
    agency: record.agency,
    description: record.description || record.scope || "",
    budget: record.budget,
    category: record.category || "Software",
    status: normalizeStatus(record),
    sourceUrl: finalSourceUrl,
    source,
    externalId: String(record.externalId || record.id || "").trim(),
    sourceStatus: record.sourceStatus || record.status,
    procurementMethod: record.procurementMethod,
    referencePrice: record.referencePrice,
    listingAnnouncedAt: record.listingAnnouncedAt ? require('./RecentProcurementWindow').publicationDate(record.listingAnnouncedAt) : undefined,
    nationalProjectId: record.nationalProjectId,
    classification: "software",
    classificationMethod: `keyword:${FILTER_VERSION}`,
    matchedKeywords: classification.matchedKeywords,
    deadline: procurementStatus === "unknown" ? null : record.deadline,
    procurementStatus,
    dataVerified: documents.length > 0,
    sourceVerifiedAt: documents.length > 0 ? now : null,
    documents,
    lastScrapedAt: now,
    rawData: record.rawData || null,
    publisherId: null,
  };
};

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

      const existing = await Project.findOne(project.nationalProjectId
        ? { $or: [{ nationalProjectId: project.nationalProjectId }, { source: project.source, externalId: project.externalId }] }
        : { source: project.source, externalId: project.externalId })
        .select("_id source sourceUrl rawData analysisHold procurementStatus analysisAutoEligible analysisSkipReason draftPublishedAt");

      if (existing) {
        // Budget/dates are owned by PDF extraction, never by listing scrapers. Draft status is set
        // below from explicit evidence only, so a listing without status never undoes a draft.
        // The listing ราคากลาง is recorded only when a project is first ingested.
        const { publisherId, budget, deadline, procurementStatus, documents, dataVerified, sourceVerifiedAt, status, referencePrice, ...updateFields } = project;
        if (project.nationalProjectId) {
          updateFields.source = existing.source;
          updateFields.rawData = { ...existing.rawData, ...project.rawData };
        }
        const terminal = nationalTerminalStatus(updateFields.rawData, project.sourceStatus);
        // Listing freshness alone cannot verify document bytes. A recently verified
        // completed analysis is renewed by the dedicated document refresh below.
        if (existing.sourceUrl !== project.sourceUrl) {
          // A changed detail URL invalidates prior AI analysis and TOR verification
          Object.assign(updateFields, { ...pendingTorExtraction(), analysisHold: false,
            analysisStatus: existing.analysisAutoEligible === false ? "skipped" : "pending",
            analysisSkipReason: existing.analysisAutoEligible === false ? existing.analysisSkipReason : "", descriptions: "", requiredSkills: [],
            aiAnalysis: {}, analysisError: "", analysisErrorCode: "", analysisRetryCount: 0, nextAnalysisAt: null,
            analysisLease: null, analysisLeaseUntil: null, analyzedAt: null,
            dataVerified: false, documents: [], sourceVerifiedAt: null, procurementStatus: "unknown" });
        }
        // FR-05: explicit draft or terminal evidence from the listing wins.
        if (status === "Draft" || terminal === "draft") {
          Object.assign(updateFields, draftFields(existing.draftPublishedAt ? undefined : draftDate(project)));
        } else if (terminal) {
          Object.assign(updateFields, { procurementStatus: terminal, status: "Public" });
        } else if (existing.procurementStatus === "draft" && project.source !== BANGKOK_SOURCE) {
          // The listing no longer says draft. (Bangkok's listing carries no status at all;
          // its drafts are resolved from announcements during enrichment instead.)
          Object.assign(updateFields, { procurementStatus: "unknown" }, leftDraftFields());
        }
        await Project.findByIdAndUpdate(existing._id, {
          $set: updateFields,
        }, { runValidators: true });
        counters.projectsUpdated += 1;
      } else {
        const terminal = nationalTerminalStatus(project.rawData, project.sourceStatus);
        const draft = project.status === "Draft" || terminal === "draft";
        await Project.create({ ...project, ...pendingTorExtraction(), analysisHold: false, procurementStatus: terminal || "unknown",
          ...(terminal ? { analysisStatus: 'skipped', analysisAutoEligible: false, analysisSkipReason: `Source is ${terminal}` } : {}),
          ...(draft ? { ...draftFields(draftDate(project)), analysisStatus: 'skipped', analysisAutoEligible: false, analysisSkipReason: DRAFT_SKIP_REASON } : {}) });
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
    // Do not report a healthy run when even some records failed to persist.
    status: counters.projectsFailed > 0 ? "Failed" : "Success",
    recordsFetched: (records || []).length,
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

function nationalTerminalStatus(rawData, sourceStatus) {
  if (!rawData?.tero && !rawData?.govspending) return null;
  if (rawData.govspending?.hasContract) return 'awarded';
  const status = String(sourceStatus || '');
  if (/ยกเลิก|cancel/i.test(status)) return 'cancelled';
  if (/ผู้ชนะ|สิ้นสุด|จัดทำสัญญา|ลงนาม|awarded|completed|closed/i.test(status)) return 'awarded';
  if (/ร่าง|draft/i.test(status)) return 'draft';
  return null;
}

module.exports = {
  ingestRecords,
  normalizeStatus,
  toProjectDocument,
  nationalTerminalStatus,
};
