const { fetchProjects, SOURCE } = require("./BangkokEgpClient");
const { ingestRecords } = require("./IngestionPipeline");
const IngestionLog = require("../models/IngestionLog");

const runBangkokEgpIngestion = async ({ budgetYear = 2569, page = 1, limit = 100 } = {}) => {
  const startedAt = new Date();
  let sourceUrl = process.env.EGP_API_URL || "https://egp2.bangkok.go.th/project-search";

  try {
    const result = await fetchProjects({ budgetYear, page, limit });
    sourceUrl = result.sourceUrl;

    return ingestRecords({
      records: result.records,
      source: SOURCE,
      sourceUrl,
      budgetYear,
      filterUsed: {
        language: ["th", "en"],
        category: "software",
        page,
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
      filterUsed: { language: ["th", "en"], category: "software", page, limit },
    });
    throw error;
  }
};

module.exports = { runBangkokEgpIngestion };
