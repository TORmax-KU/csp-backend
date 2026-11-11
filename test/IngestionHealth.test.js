const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchSource } = require("../src/services/SourceFetch");
const { summarizeSource, ingestionHealth, createIngestionMonitor, ALERT_AFTER } = require("../src/services/IngestionHealth");
const { createScheduler } = require("../src/services/IngestionScheduler");

// A fetch that honours AbortSignal but otherwise never settles, like a hung portal.
const hangingFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
  signal.addEventListener("abort", () => reject(signal.reason));
});

test("NFR-04: a portal that does not respond in time is abandoned with SOURCE_TIMEOUT", async () => {
  await assert.rejects(
    fetchSource("https://portal.example.go.th/list", {}, { fetchImpl: hangingFetch, responseTimeoutMs: 20 }),
    error => error.code === "SOURCE_TIMEOUT" && /portal\.example\.go\.th did not respond/.test(error.message),
  );
});

test("a slow download that has started gets the separate body limit", async () => {
  const slowBody = async (_url, { signal }) => ({ ok: true, text: () => hangingFetch(null, { signal }) });
  await assert.rejects(
    fetchSource("https://portal.example.go.th/big", {}, { fetchImpl: slowBody, responseTimeoutMs: 1000, bodyTimeoutMs: 20, read: r => r.text() }),
    error => error.code === "SOURCE_TIMEOUT" && /did not finish/.test(error.message),
  );
  const ok = async () => ({ ok: true, json: async () => ({ rows: 3 }) });
  assert.deepEqual(await fetchSource("https://portal.example.go.th/ok", {}, { fetchImpl: ok, read: r => r.json() }), { rows: 3 });
});

const at = minutes => new Date(Date.UTC(2026, 10, 11, 0, minutes));
const run = (status, recordsFetched, minutes, errorMessage = "") => ({ status, recordsFetched, startedAt: at(minutes), errorMessage });

test("health counts failures and suspicious empty runs, newest first", () => {
  const logs = [run("Failed", undefined, 30, "SOURCE_TIMEOUT: x"), run("Success", 0, 25), run("Success", 0, 20), run("Success", 40, 15), run("Success", 38, 10)];
  const health = summarizeSource("gistda-procurement", logs);
  assert.equal(health.failed, 1);
  assert.equal(health.empty, 2);
  assert.equal(health.succeeded, 2);
  assert.equal(health.successRate, 0.4);
  assert.equal(health.consecutiveProblems, 3);
  assert.equal(health.alerting, true);
  assert.equal(health.lastSuccessAt.getTime(), at(15).getTime());
  assert.equal(health.lastError, "SOURCE_TIMEOUT: x");
  // A source that has never returned listings is not "broken" when empty.
  assert.equal(summarizeSource("ieat-procurement", [run("Success", 0, 5), run("Success", 0, 0)]).empty, 0);
});

test("overall success rate is compared with the 95% target", async () => {
  const rows = [
    ...Array.from({ length: 19 }, (_, i) => ({ source: "bangkok-egp", ...run("Success", 100, i) })),
    { source: "bangkok-egp", ...run("Failed", undefined, 30) },
  ];
  const logs = { find: () => ({ select: () => ({ sort: () => ({ lean: async () => rows.reverse() }) }) }) };
  const health = await ingestionHealth({ logs });
  assert.equal(health.overall.successRate, 0.95);
  assert.equal(health.overall.meetsTarget, true);
});

test("monitor alerts once after consecutive problems, then once on recovery", async () => {
  const sent = [];
  let hadListings = true;
  const monitor = createIngestionMonitor({ env: {}, notify: async text => sent.push(text), logs: { exists: async () => hadListings } });
  for (let i = 1; i < ALERT_AFTER; i++) await monitor.observe("egat-bidding", { error: new Error("HTTP 503") });
  assert.equal(sent.length, 0, "no alert before the threshold");
  await monitor.observe("egat-bidding", { log: { status: "Success", recordsFetched: 0 } });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /0 listings/);
  await monitor.observe("egat-bidding", { error: new Error("HTTP 503") });
  assert.equal(sent.length, 1, "no repeat alert while still failing");
  await monitor.observe("egat-bidding", { log: { status: "Success", recordsFetched: 12 } });
  assert.match(sent[1], /recovered/);

  // Zero listings from a source with no recent listings is not a problem.
  hadListings = false;
  assert.deepEqual(await monitor.observe("ieat-procurement", { log: { status: "Success", recordsFetched: 0 } }), { problem: false });
});

test("scheduler reports outcomes to the monitor and survives monitor errors", async () => {
  const seen = [];
  const errors = [];
  const logger = { log() {}, error: (...args) => errors.push(args.join(" ")) };
  const monitor = { observe: async (source, outcome) => { seen.push([source, outcome.error ? "error" : outcome.log.status]); if (outcome.error) throw new Error("webhook down"); return {}; } };
  const scheduler = createScheduler({ env: {}, logger, monitor, schedule: () => ({ getNextRun: () => null }), runners: {
    "egat-bidding": async () => ({ status: "Success", recordsFetched: 5 }),
    "ieat-procurement": async () => { throw Object.assign(new Error("timed out"), { code: "SOURCE_TIMEOUT" }); },
  } });
  scheduler.startIngestionScheduler();
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen.sort(), [["egat-bidding", "Success"], ["ieat-procurement", "error"]]);
  const states = Object.fromEntries(scheduler.ingestionStatus().sources.map(s => [s.source, s]));
  assert.equal(states["ieat-procurement"].code, "SOURCE_TIMEOUT");
  assert.ok(errors.some(line => /monitor failed/.test(line)));
});
