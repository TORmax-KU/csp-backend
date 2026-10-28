const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveProcurementStatus } = require('../src/services/BangkokEgpDetailClient');
const { availability, draftProjectQuery, MAX_AGE_MS } = require('../src/services/ProcurementAvailability');
const { buildProjectQuery } = require('../src/services/ProjectSearch');
const { normalizeStatus } = require('../src/services/IngestionPipeline');

test('Bangkok draft announcements are drafts until a final invitation appears', () => {
  const draft = [{ type: 'ร่างขอบเขตของงาน (TOR)', publishDate: '2026-10-01' }, { type: 'ร่างประกาศเชิญชวน', publishDate: '2026-10-02' }];
  assert.equal(deriveProcurementStatus(draft), 'draft');
  assert.equal(deriveProcurementStatus([...draft, { type: 'ประกาศเชิญชวน', publishDate: '2026-10-10' }]), 'open');
  assert.equal(deriveProcurementStatus(draft, { sourceStatusCode: 'S5' }), 'cancelled');
});

test('draft status labels are recognized wherever they appear in the source text', () => {
  assert.equal(normalizeStatus({ status: 'ร่างประกาศเชิญชวน' }), 'Draft');
  assert.equal(normalizeStatus({ sourceStatus: 'Draft TOR' }), 'Draft');
  assert.equal(normalizeStatus({ status: 'S1' }), 'Public');
});

test('a Draft project reports draft availability', () => {
  assert.equal(availability({ status: 'Draft', procurementStatus: 'unknown' }), 'draft');
  assert.equal(availability({ status: 'Public', procurementStatus: 'draft' }), 'draft');
});

test('draft search uses the draft query and keeps every other filter', async () => {
  const now = new Date('2026-10-29T08:00:00+07:00');
  const { query } = await buildProjectQuery({ availability: 'draft', search: 'ระบบ', agency: 'เขต', method: 'e-bidding' }, async () => [], now);
  assert.deepEqual(query.$and[0], { $or: [{ status: 'Draft' }, { procurementStatus: 'draft' }] });
  assert.equal(query.status, undefined);
  assert.equal(query.analysisStatus, undefined);
  assert.equal(query.lastScrapedAt.$gte.getTime(), now.getTime() - MAX_AGE_MS);
  assert.ok(query.$or.some(clause => clause.title));
  assert.ok(query.agency);
  assert.ok(query.$and.some(part => part.procurementMethod));
  assert.equal(query.procurementMethod.$regex, 'e-bidding');
  assert.equal(draftProjectQuery(now).classification, 'software');
});

test('priceFlag filter accepts only known flags', async () => {
  const { query } = await buildProjectQuery({ priceFlag: 'Overpriced' }, async () => []);
  assert.equal(query.priceFlag, 'Overpriced');
  await assert.rejects(buildProjectQuery({ priceFlag: 'Cheap' }, async () => []), { status: 400 });
});
