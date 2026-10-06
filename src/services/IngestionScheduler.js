const cron = require("node-cron");
const IngestionLog = require("../models/IngestionLog");
const { fetchAnnouncements, SOURCE, SEARCH_PAGE } = require("./GprocurementClient");
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

function startIngestionScheduler() {
  if (scheduledTask) return scheduledTask;
  if (process.env.GPROC_INGESTION_ENABLED === "false") { state.status = "disabled"; return null; }
  scheduledTask = cron.schedule(SCHEDULE, runOnce, { timezone: "Asia/Bangkok" });
  console.log("National e-GP ingestion: on startup and every 5 minutes");
  void runOnce();
  return scheduledTask;
}
module.exports = { startIngestionScheduler, runOnce, ingestionStatus };
