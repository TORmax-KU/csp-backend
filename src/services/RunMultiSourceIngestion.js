/**
 * RunMultiSourceIngestion.js
 *
 * Shared ingestion runner for non-Bangkok sources that follow the same
 * fetch-then-ingest pattern:
 *
 *   1. client.fetchListings() → { source, sourceUrl, records }
 *   2. ingestRecords()        → IngestionLog document
 *
 * Each source gets its own named runner export so the scheduler can call
 * them individually and log failures per-source without blocking others.
 */

const { ingestRecords } = require("./IngestionPipeline");
const IngestionLog = require("../models/IngestionLog");
const { fetchListings: fetchEgat, SOURCE: EGAT_SOURCE } = require("./EgatBiddingClient");
const { fetchListings: fetchIeat, SOURCE: IEAT_SOURCE } = require("./IeatProcurementClient");
const { fetchListings: fetchGistda, SOURCE: GISTDA_SOURCE } = require("./GistdaProcurementClient");

/**
 * Generic runner: fetch listings from a client and pipe through IngestionPipeline.
 *
 * @param {string}   sourceName  — Human-readable label for logs
 * @param {Function} fetchFn     — Async function returning { source, sourceUrl, records }
 * @param {object}   [opts]      — Optional overrides forwarded to fetchFn
 */
const runSource = async (sourceName, fetchFn, opts = {}) => {
  const startedAt = new Date();
  let sourceUrl = opts.fallbackUrl || "";

  try {
    const { source, sourceUrl: fetchedUrl, records } = await fetchFn(opts);
    sourceUrl = fetchedUrl || sourceUrl;

    const log = await ingestRecords({
      records,
      source,
      sourceUrl,
      filterUsed: { language: ["th", "en"], category: "software" },
    });

    console.log(
      `${sourceName} ingestion finished: ${log.status}, ` +
      `${log.projectsCreated ?? 0} created, ${log.projectsUpdated ?? 0} updated, ` +
      `${log.projectsFiltered ?? 0} filtered, ${log.projectsSkipped ?? 0} skipped`
    );
    return log;
  } catch (error) {
    const code = String(error.code || "").startsWith("SOURCE_") ? error.code : "SOURCE_UNAVAILABLE";
    console.error(`${sourceName} ingestion failed:`, code, error.message);

    await IngestionLog.create({
      source: sourceName.toLowerCase().replace(/\s+/g, "-"),
      sourceUrl,
      status: "Failed",
      errorMessage: `${code}: ${error.message}`,
      torsIngested: 0,
      startedAt,
      finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }).catch((e) => console.error(`Cannot save ${sourceName} ingestion log:`, e.message));

    throw error;
  }
};

const runEgatBiddingIngestion = (opts = {}) =>
  runSource("EGAT Bidding", fetchEgat, { fallbackUrl: "https://bidding.egat.co.th/procure/procure_list.php", ...opts });

const runIeatIngestion = (opts = {}) =>
  runSource("IEAT Procurement", fetchIeat, { fallbackUrl: "https://iprocurement.ieat.go.th/news", ...opts });

const runGistdaIngestion = (opts = {}) =>
  runSource("GISTDA Procurement", fetchGistda, { fallbackUrl: "https://www.gistda.or.th/procurement/", ...opts });

module.exports = {
  runEgatBiddingIngestion,
  runIeatIngestion,
  runGistdaIngestion,
  EGAT_SOURCE,
  IEAT_SOURCE,
  GISTDA_SOURCE,
};

