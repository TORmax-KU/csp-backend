const cron = require("node-cron");
const { runBangkokEgpIngestion } = require("./RunBangkokEgpIngestion");

// TEMP for testing: every 2 minutes (revert to "0 */6 * * *" afterward)
const DEFAULT_SCHEDULE = "*/2 * * * *";
const DEFAULT_PAGES_PER_RUN = 10;

let scheduledTask = null;
let isRunning = false;

const runOnce = async () => {
  if (isRunning) {
    console.warn("Bangkok EGP ingestion already running, skipping this tick");
    return;
  }

  isRunning = true;
  try {
    const budgetYear = Number(process.env.EGP_BUDGET_YEAR || 2569);
    const limit = Number(process.env.EGP_INGEST_LIMIT || 100);
    const configuredPages = Number(
      process.env.EGP_INGEST_PAGES || DEFAULT_PAGES_PER_RUN
    );
    const pages = Number.isInteger(configuredPages) && configuredPages > 0
      ? configuredPages
      : DEFAULT_PAGES_PER_RUN;
    console.log(
      `Starting scheduled Bangkok EGP ingestion ` +
      `(budgetYear=${budgetYear}, pages=1-${pages})`
    );
    const log = await runBangkokEgpIngestion({
      budgetYear,
      page: 1,
      pages,
      limit,
    });
    console.log(`Scheduled Bangkok EGP ingestion finished: ${log.status}, ${log.torsIngested} project(s) ingested`);
  } catch (error) {
    console.error("Scheduled Bangkok EGP ingestion failed:", error.message);
  } finally {
    isRunning = false;
  }
};

const startIngestionScheduler = () => {
  if (scheduledTask) return scheduledTask;

  if (process.env.EGP_INGESTION_ENABLED === "false") {
    console.log("Bangkok EGP ingestion scheduler disabled via EGP_INGESTION_ENABLED=false");
    return null;
  }

  const schedule = process.env.EGP_INGESTION_CRON || DEFAULT_SCHEDULE;
  if (!cron.validate(schedule)) {
    console.error(`Invalid EGP_INGESTION_CRON expression "${schedule}", scheduler not started`);
    return null;
  }

  scheduledTask = cron.schedule(schedule, runOnce);
  console.log(`Bangkok EGP ingestion scheduled with cron "${schedule}"`);
  return scheduledTask;
};

module.exports = { startIngestionScheduler, runOnce };
