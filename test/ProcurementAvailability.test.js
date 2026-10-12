const test = require('node:test');
const assert = require('node:assert/strict');
const { availability, publicProjectQuery, MAX_AGE_MS } = require('../src/services/ProcurementAvailability');
const { budgetYear, readSearchResponse, fetchAnnouncements } = require('../src/services/GprocurementClient');
const now = new Date('2026-10-05T10:00:00+07:00');
const project = { procurementStatus: 'open', deadline: '2026-10-05T10:00:01+07:00', dataVerified: true, sourceVerifiedAt: now };

test('deadline closes at the exact instant; terminal statuses override future deadlines', () => {
  assert.equal(availability(project, now), 'open');
  assert.equal(availability({ ...project, deadline: now }, now), 'closed');
  for (const status of ['closed', 'awarded', 'cancelled', 'draft']) assert.equal(availability({ ...project, procurementStatus: status }, now), status);
  assert.equal(availability({ ...project, deadline: null }, now), 'unknown');
  assert.equal(availability({ ...project, sourceVerifiedAt: new Date(now - MAX_AGE_MS - 1) }, now), 'unverified');
  assert.equal(availability({ ...project, dataVerified: false }, now), 'unverified');
});

test('public query requires source verification and a recently verified TOR', () => {
  const query = publicProjectQuery(now);
  assert.deepEqual(query.source, { $in: ['gprocurement', 'bangkok-egp'] });
  assert.equal(query.documents.$elemMatch.kind, 'tor');
  assert.equal(query.documents.$elemMatch.verifiedAt.$gte.getTime(), now - MAX_AGE_MS);
});

test('Thai fiscal year rolls over in October Bangkok time', () => {
  assert.equal(budgetYear(new Date('2026-09-30T16:59:59Z')), 2569);
  assert.equal(budgetYear(new Date('2026-09-30T17:00:00Z')), 2570);
});

test('Cloudflare rejection is an access failure, never an empty successful import', async () => {
  assert.throws(() => readSearchResponse({ validateCfTurnTile: false }), { code: 'SOURCE_ACCESS_REQUIRED' });
  assert.throws(() => readSearchResponse({ validateAnnouncementToken: 0 }), { code: 'SOURCE_ACCESS_REQUIRED' });
  assert.throws(() => readSearchResponse({ data: { elasticSearchError: true } }), { code: 'SOURCE_UNAVAILABLE' });
  assert.throws(() => readSearchResponse({ changed: [] }), { code: 'SOURCE_SCHEMA_CHANGED' });
  assert.deepEqual(readSearchResponse({ data: { data: [] } }), []);
  await assert.rejects(fetchAnnouncements({ fetchImpl: async () => ({ ok: true, json: async () => ({ validateCfTurnTile: false }) }) }), { code: 'SOURCE_ACCESS_REQUIRED' });
});
