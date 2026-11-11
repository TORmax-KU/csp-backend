// Open Issue 1 / NFR-08 / Use Case 6: detect broken scrapers and report the success rate.
//
// A run is a problem when it fails, or when it "succeeds" with zero listings although the
// same source returned listings recently — the usual symptom of changed portal markup.
const IngestionLog = require("../models/IngestionLog");

const SUCCESS_TARGET = 0.95;          // NFR-08
const ALERT_AFTER = 3;                // consecutive problem runs (15 minutes at the 5-minute schedule)
const EMPTY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

const isEmpty = log => log.status === "Success" && log.recordsFetched === 0;

// Per-source health over a window. `logs` are one source's runs, newest first.
function summarizeSource(source, logs) {
  const nonEmptySeen = logs.some(log => log.status === "Success" && log.recordsFetched > 0);
  const problem = log => log.status === "Failed" || (isEmpty(log) && nonEmptySeen);
  const failed = logs.filter(log => log.status === "Failed").length;
  const empty = logs.filter(log => isEmpty(log) && nonEmptySeen).length;
  const succeeded = logs.length - failed - empty;
  let consecutiveProblems = 0;
  while (consecutiveProblems < logs.length && problem(logs[consecutiveProblems])) consecutiveProblems += 1;
  const lastSuccess = logs.find(log => !problem(log));
  const lastFailure = logs.find(log => log.status === "Failed");
  return {
    source,
    runs: logs.length,
    succeeded,
    failed,
    empty,
    successRate: logs.length ? Math.round(succeeded / logs.length * 1000) / 1000 : null,
    lastRunAt: logs[0]?.startedAt ?? null,
    lastSuccessAt: lastSuccess?.startedAt ?? null,
    lastError: lastFailure?.errorMessage || null,
    consecutiveProblems,
    alerting: consecutiveProblems >= ALERT_AFTER,
  };
}

async function ingestionHealth({ logs = IngestionLog, days = 7, now = new Date() } = {}) {
  const since = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await logs.find({ startedAt: { $gte: since } })
    .select("source status recordsFetched errorMessage startedAt")
    .sort({ startedAt: -1, _id: -1 }).lean();
  const bySource = new Map();
  for (const row of rows) {
    if (!bySource.has(row.source)) bySource.set(row.source, []);
    bySource.get(row.source).push(row);
  }
  const sources = [...bySource].map(([source, sourceLogs]) => summarizeSource(source, sourceLogs))
    .sort((a, b) => a.source.localeCompare(b.source));
  const runs = sources.reduce((sum, s) => sum + s.runs, 0);
  const succeeded = sources.reduce((sum, s) => sum + s.succeeded, 0);
  const successRate = runs ? Math.round(succeeded / runs * 1000) / 1000 : null;
  return {
    windowDays: days, since, target: SUCCESS_TARGET,
    overall: { runs, succeeded, successRate, meetsTarget: successRate === null ? null : successRate >= SUCCESS_TARGET },
    sources,
  };
}

// Posts to a Slack- or Discord-compatible incoming webhook (both read their own key).
async function postWebhook(url, text, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Alert webhook returned HTTP ${response.status}`);
}

// Tracks consecutive problem runs per source and alerts once when a source crosses the
// threshold, then once when it recovers. In-memory: the log-based report above is the record.
function createIngestionMonitor({ env = process.env, logs = IngestionLog, logger = console, notify, now = () => new Date() } = {}) {
  const webhook = env.INGESTION_ALERT_WEBHOOK_URL;
  const send = notify || (async text => {
    logger.error(`[ingestion alert] ${text}`);
    if (webhook) await postWebhook(webhook, `[TORmax] ${text}`).catch(error => logger.error("Ingestion alert webhook failed:", error.message));
  });
  const streaks = new Map();

  // A zero-listing run is suspicious only if the source returned listings within the lookback.
  async function suspiciousEmpty(source, log) {
    if (!isEmpty(log)) return false;
    const since = new Date(now().getTime() - EMPTY_LOOKBACK_MS);
    return Boolean(await logs.exists({ source, status: "Success", recordsFetched: { $gt: 0 }, startedAt: { $gte: since } }));
  }

  async function observe(source, { log, error } = {}) {
    const failed = Boolean(error) || log?.status === "Failed";
    const empty = !failed && log ? await suspiciousEmpty(source, log) : false;
    const streak = streaks.get(source) || { count: 0, alerted: false };
    if (!failed && !empty) {
      if (streak.alerted) await send(`${source} recovered after ${streak.count} problem runs.`);
      streaks.set(source, { count: 0, alerted: false });
      return { problem: false };
    }
    streak.count += 1;
    if (streak.count >= ALERT_AFTER && !streak.alerted) {
      streak.alerted = true;
      await send(failed
        ? `${source} failed ${streak.count} runs in a row. Last error: ${error?.message || log?.errorMessage || "unknown"}`
        : `${source} returned 0 listings ${streak.count} runs in a row although it had listings recently; its page markup may have changed.`);
    }
    streaks.set(source, streak);
    return { problem: true, reason: failed ? "failed" : "empty", count: streak.count };
  }

  return { observe };
}

module.exports = { SUCCESS_TARGET, ALERT_AFTER, summarizeSource, ingestionHealth, createIngestionMonitor, postWebhook };
