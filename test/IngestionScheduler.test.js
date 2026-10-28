const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../src/services/IngestionScheduler');
const sources = ['bangkok-egp', 'egat-bidding', 'ieat-procurement', 'gistda-procurement'];
const logger = { log() {}, error() {} };
const flush = () => new Promise(resolve => setImmediate(resolve));

test('only four active sources start and schedule; the retired national flag cannot disable them', async () => {
  const called = [], scheduled = [];
  const scheduler = createScheduler({ env: { GPROC_INGESTION_ENABLED: 'false' }, logger,
    runners: Object.fromEntries(sources.map(source => [source, async () => { called.push(source); return { status: 'Success' }; }])),
    schedule: (expression, callback, options) => { scheduled.push({ expression, callback, options }); return { getNextRun: () => new Date('2026-10-28T10:00:00Z') }; } });
  scheduler.startIngestionScheduler();
  scheduler.startIngestionScheduler();
  await flush();
  assert.deepEqual(called.sort(), [...sources].sort());
  assert.equal(scheduled.length, 4);
  assert.ok(scheduled.every(t => t.expression === '*/5 * * * *' && t.options.timezone === 'Asia/Bangkok'));
  assert.equal(scheduler.ingestionStatus().source, 'bangkok-egp');
  assert.equal(scheduler.ingestionStatus().status, 'success');
});

test('each source flag is independent and the new global switch can disable all sources', async () => {
  for (const env of [{ BANGKOK_INGESTION_ENABLED: 'false' }, { INGESTION_ENABLED: 'false' }]) {
    const called = [];
    const scheduler = createScheduler({ env, logger, runners: Object.fromEntries(sources.map(source => [source, async () => called.push(source)])), schedule: () => ({ getNextRun: () => null }) });
    scheduler.startIngestionScheduler(); await flush();
    assert.equal(called.length, env.INGESTION_ENABLED === 'false' ? 0 : 3);
    assert.equal(scheduler.ingestionStatus().status, 'disabled');
  }
});

test('overlapping ticks for the same source are skipped and failures remain observable', async () => {
  let finish, attempts = 0;
  const scheduler = createScheduler({ env: {}, logger, schedule: () => ({}), runners: {
    'bangkok-egp': () => { attempts++; return new Promise(resolve => { finish = resolve; }); },
  } });
  const first = scheduler.runBangkokOnce(); await scheduler.runBangkokOnce();
  assert.equal(attempts, 1); assert.equal(scheduler.ingestionStatus().status, 'running');
  finish({ status: 'Failed' }); await first;
  assert.equal(scheduler.ingestionStatus().status, 'failed');
  assert.equal(scheduler.ingestionStatus().code, 'SOURCE_UNAVAILABLE');
});
