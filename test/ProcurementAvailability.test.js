const test = require('node:test');
const assert = require('node:assert/strict');
const { availability, publicProjectQuery, MAX_AGE_MS } = require('../src/services/ProcurementAvailability');
const { budgetYear } = require('../src/services/ProcurementCalendar');
const now = new Date('2026-10-05T10:00:00+07:00');
const project = { procurementStatus: 'open', deadline: '2026-10-05T10:00:01+07:00', deadlinePrecision: 'datetime', dataVerified: true, sourceVerifiedAt: now };

test('date-only deadlines remain on their listed day without inventing a closing time', () => {
  const dateOnly = { ...project, deadlinePrecision: 'date', deadline: '2026-10-05T00:00:00Z' };
  assert.equal(availability(dateOnly, now), 'open');
  assert.equal(availability(dateOnly, new Date('2026-10-06T00:00:00+07:00')), 'closed');
});

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
  assert.deepEqual(query.source, { $in: ['bangkok-egp', 'egat-bidding', 'ieat-procurement', 'gistda-procurement', 'tero-procurement', 'govspending'] });
  assert.equal(query.documents.$elemMatch.kind, 'tor');
  assert.equal(query.documents.$elemMatch.verifiedAt.$gte.getTime(), now - MAX_AGE_MS);
  assert.equal(query.analysisStatus, 'completed');
  assert.equal(query.descriptions.$regex, '\\S');
  assert.equal(query['aiAnalysis.fieldResults.budget.status'], 'found');
  assert.equal(query['aiAnalysis.fieldResults.announcedAt.status'], 'found');
  assert.equal(query['aiAnalysis.fieldResults.deadline.status'], 'found');
});

test('Thai fiscal year rolls over in October Bangkok time', () => {
  assert.equal(budgetYear(new Date('2026-09-30T16:59:59Z')), 2569);
  assert.equal(budgetYear(new Date('2026-09-30T17:00:00Z')), 2570);
});
