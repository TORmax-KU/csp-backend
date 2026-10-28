const cron = require('node-cron');
const { runBangkokEgpIngestion } = require('./RunBangkokEgpIngestion');
const { enrichBangkokProjects } = require('./BangkokEgpEnrichment');
const { runEgatBiddingIngestion, runIeatIngestion, runGistdaIngestion } = require('./RunMultiSourceIngestion');
const SCHEDULE = '*/5 * * * *';
const { runTeroIngestion, runGovSpendingIngestion } = require('./RunNationalSourcesIngestion');

async function ingestBangkok() {
  const log = await runBangkokEgpIngestion();
  console.log(`Bangkok e-GP ingestion finished: ${log.status}, ${log.projectsCreated} created, ${log.projectsUpdated} updated`);
  const enrichment = await enrichBangkokProjects({ batchSize: Number(process.env.BANGKOK_ENRICH_BATCH || 25) });
  console.log(`Bangkok e-GP enrichment: ${enrichment.enriched} enriched, ${enrichment.failed} failed, ${enrichment.scanned} scanned`);
  return log;
}

function createScheduler({ schedule = cron.schedule, env = process.env, runners = {
  'bangkok-egp': ingestBangkok, 'egat-bidding': runEgatBiddingIngestion,
  'ieat-procurement': runIeatIngestion, 'gistda-procurement': runGistdaIngestion,
  'tero-procurement': runTeroIngestion, 'govspending': runGovSpendingIngestion,
}, logger = console } = {}) {
  const flags = { 'bangkok-egp': 'BANGKOK_INGESTION_ENABLED', 'egat-bidding': 'EGAT_INGESTION_ENABLED',
    'ieat-procurement': 'IEAT_INGESTION_ENABLED', 'gistda-procurement': 'GISTDA_INGESTION_ENABLED' };
  Object.assign(flags, { 'tero-procurement': 'TERO_INGESTION_ENABLED', govspending: 'GOVSPENDING_INGESTION_ENABLED' });
  const states = Object.fromEntries(Object.keys(runners).map(source => [source, {
    source, status: 'idle', code: null, lastAttemptAt: null, lastSuccessAt: null, nextAttemptAt: null, intervalMinutes: 5,
  }]));
  const tasks = {};
  let started = false;
  async function runSource(source) {
    const state = states[source];
    if (state.status === 'running') return;
    Object.assign(state, { status: 'running', code: null, lastAttemptAt: new Date().toISOString() });
    try {
      const result = await runners[source]();
      if (result?.status === 'Failed') throw new Error('Source import failed; inspect ingestion logs');
      Object.assign(state, { status: 'success', lastSuccessAt: new Date().toISOString() });
      return result;
    } catch (error) {
      Object.assign(state, { status: 'failed', code: error.code || 'SOURCE_UNAVAILABLE' });
      logger.error(`${source} ingestion failed:`, error.message);
    } finally {
      state.nextAttemptAt = tasks[source]?.getNextRun()?.toISOString() || null;
    }
  }
  function startIngestionScheduler() {
    if (started) return tasks;
    started = true;
    for (const source of Object.keys(runners)) {
      if (env.INGESTION_ENABLED === 'false' || env[flags[source]] === 'false') {
        states[source].status = 'disabled';
        continue;
      }
      tasks[source] = schedule(SCHEDULE, () => runSource(source), { timezone: 'Asia/Bangkok' });
      logger.log(`${source} ingestion: on startup and every 5 minutes`);
      void runSource(source);
    }
    return tasks;
  }
  // Keep the public response shape, now reporting the feed's Bangkok source.
  const ingestionStatus = () => ({ ...states['bangkok-egp'], sources: Object.values(states).map(state => ({ ...state })) });
  return { startIngestionScheduler, ingestionStatus,
    runBangkokOnce: () => runSource('bangkok-egp'), runEgatOnce: () => runSource('egat-bidding'),
    runIeatOnce: () => runSource('ieat-procurement'), runGistdaOnce: () => runSource('gistda-procurement') };
}

module.exports = { ...createScheduler(), createScheduler };
