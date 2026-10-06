const { fetchProjects, SOURCE } = require("./BangkokEgpClient");
const { ingestRecords } = require("./IngestionPipeline");
const IngestionLog = require("../models/IngestionLog");

const runBangkokEgpIngestion = async ({
  budgetYear = Number(process.env.EGP_BUDGET_YEAR || 2569),
  page = 1,
  pages = Number(process.env.EGP_INGEST_PAGES || 10),
  limit = Number(process.env.EGP_INGEST_LIMIT || 100),
} = {}) => {
  const startedAt = new Date();
  let sourceUrl = process.env.EGP_API_URL || "https://egp2.bangkok.go.th/project-search";
  let pagesFetched = 0;

  try {
    const records = [];

    for (let pageOffset = 0; pageOffset < pages; pageOffset += 1) {
      const currentPage = page + pageOffset;
      const result = await fetchProjects({ budgetYear, page: currentPage, limit });
      sourceUrl = result.sourceUrl;
      records.push(...result.records);
      pagesFetched += 1;

      if (result.rawPayload?.hasNextPage === false) break;
    }

    return ingestRecords({
      records,
      source: SOURCE,
      sourceUrl,
      budgetYear,
      filterUsed: { language: ["th", "en"], category: "software", startPage: page, pagesFetched, limit },
    });
  } catch (error) {
    await IngestionLog.create({
      source: SOURCE,
      sourceUrl,
      budgetYear,
      status: "Failed",
      errorMessage: error.message,
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
      filterUsed: { language: ["th", "en"], category: "software", startPage: page, pagesFetched, limit },
    });
    throw error;
  }
};

module.exports = { runBangkokEgpIngestion };
