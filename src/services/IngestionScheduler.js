const cron = require("node-cron");
const IngestionLog = require("../models/IngestionLog");
const { fetchAnnouncements, SOURCE, SEARCH_PAGE } = require("./GprocurementClient");
const { runBangkokEgpIngestion } = require("./RunBangkokEgpIngestion");
const { enrichBangkokProjects } = require("./BangkokEgpEnrichment");
const { runEgatBiddingIngestion, runIeatIngestion, runGistdaIngestion } = require("./RunMultiSourceIngestion");
const SCHEDULE = "*/5 * * * *";
let scheduledTask;
let running = false;
const state = { status: "idle", code: null, lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, intervalMinutes: 5 };
const ingestionStatus = () => ({ ...state });

async function runOnce() {
  if (running) return;
  running = true;
  const startedAt = new Date();
  Object.assign(state, { status: "running", code: null, lastAttemptAt: startedAt.toISOString() });
  try {
    const result = await fetchAnnouncements();
    // Search listings alone cannot establish bid deadlines or a working TOR document.
    // Publication remains blocked until actual detail/document responses are validated.
    if (result.rows.length) throw Object.assign(new Error("Source access is available, but detail/deadline/document mapping still requires verification before publication."), { code: "SOURCE_DETAILS_REQUIRED" });
    Object.assign(state, { status: "success", lastSuccessAt: new Date().toISOString() });
    await IngestionLog.create({ source: SOURCE, sourceUrl: SEARCH_PAGE, status: "Success", torsIngested: 0, startedAt, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() });
  } catch (error) {
    const code = String(error.code || "").startsWith("SOURCE_") ? error.code : "SOURCE_UNAVAILABLE";
    Object.assign(state, { status: "failed", code });
    console.error("e-GP ingestion:", code, error.message);
    await IngestionLog.create({ source: SOURCE, sourceUrl: SEARCH_PAGE, status: "Failed", errorMessage: code + ": " + error.message, startedAt, finishedAt: new Date(), durationMs: Date.now() - startedAt.getTime() }).catch(error => console.error("Cannot save ingestion log:", error.message));
  } finally {
    running = false;
    state.nextAttemptAt = scheduledTask?.getNextRun()?.toISOString() || null;
  }
}

async function runBangkokOnce() {
  try {
    const log = await runBangkokEgpIngestion();
    console.log(`Bangkok e-GP ingestion finished: ${log.status}, ${log.torsIngested} project(s) ingested`);
    const batchSize = Number(process.env.BANGKOK_ENRICH_BATCH || 25);
    const enrich = await enrichBangkokProjects({ batchSize });
    console.log(`Bangkok e-GP enrichment: ${enrich.enriched} enriched, ${enrich.failed} failed, ${enrich.scanned} scanned`);
  } catch (error) {
    console.error("Bangkok e-GP ingestion failed:", error.message);
  }
}

async function runEgatOnce() {
  try {
    await runEgatBiddingIngestion();
  } catch (error) {
    console.error("EGAT Bidding ingestion failed:", error.message);
  }
}

async function runIeatOnce() {
  try {
    await runIeatIngestion();
  } catch (error) {
    console.error("IEAT Procurement ingestion failed:", error.message);
  }
}

async function runGistdaOnce() {
  try {
    await runGistdaIngestion();
  } catch (error) {
    console.error("GISTDA Procurement ingestion failed:", error.message);
  }
}

function startIngestionScheduler() {
  if (scheduledTask) return scheduledTask;
  if (process.env.GPROC_INGESTION_ENABLED === "false") { state.status = "disabled"; return null; }
  scheduledTask = cron.schedule(SCHEDULE, runOnce, { timezone: "Asia/Bangkok" });
  console.log("National e-GP ingestion: on startup and every 5 minutes");
  void runOnce();
  if (process.env.BANGKOK_INGESTION_ENABLED !== "false") {
    void runBangkokOnce();
    cron.schedule(SCHEDULE, runBangkokOnce, { timezone: "Asia/Bangkok" });
    console.log("Bangkok e-GP ingestion: on startup and every 5 minutes");
  }
  if (process.env.EGAT_INGESTION_ENABLED !== "false") {
    void runEgatOnce();
    cron.schedule(SCHEDULE, runEgatOnce, { timezone: "Asia/Bangkok" });
    console.log("EGAT Bidding ingestion: on startup and every 5 minutes");
  }
  if (process.env.IEAT_INGESTION_ENABLED !== "false") {
    void runIeatOnce();
    cron.schedule(SCHEDULE, runIeatOnce, { timezone: "Asia/Bangkok" });
    console.log("IEAT Procurement ingestion: on startup and every 5 minutes");
  }
  if (process.env.GISTDA_INGESTION_ENABLED !== "false") {
    void runGistdaOnce();
    cron.schedule(SCHEDULE, runGistdaOnce, { timezone: "Asia/Bangkok" });
    console.log("GISTDA Procurement ingestion: on startup and every 5 minutes");
  }
  return scheduledTask;
}
module.exports = { startIngestionScheduler, runOnce, runBangkokOnce, runEgatOnce, runIeatOnce, runGistdaOnce, ingestionStatus };
