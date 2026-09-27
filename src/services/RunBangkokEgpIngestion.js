const { DEFAULT_SEARCH_URL, fetchProjects, SOURCE } = require("./BangkokEgpClient");
const { ingestRecords } = require("./IngestionPipeline");
const IngestionLog = require("../models/IngestionLog");

const runBangkokEgpIngestion = async ({
  budgetYear = 2569,
  page = 1,
  pages = 1,
  limit = 100,
} = {}) => {
  const startedAt = new Date();
  let sourceUrl = process.env.EGP_API_URL || DEFAULT_SEARCH_URL;
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
      filterUsed: {
        language: ["th", "en"],
        category: "software",
        startPage: page,
        endPage: page + pagesFetched - 1,
        pagesRequested: pages,
        pagesFetched,
        limit,
      },
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
      filterUsed: {
        language: ["th", "en"],
        category: "software",
        startPage: page,
        pagesRequested: pages,
        pagesFetched,
        limit,
      },
    });
    throw error;
  }
};

module.exports = { runBangkokEgpIngestion };
