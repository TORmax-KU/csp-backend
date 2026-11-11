const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { ProjectSchema } = require('../schemas/ProjectModel');
const { buildProjectQuery } = require('../src/services/ProjectSearch');

test('MongoDB returns only open TORs with all AI fields, plus open direct postings', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const connection = await mongoose.createConnection(process.env.TEST_MONGO_URI).asPromise();
  const collection = `procurement_test_${randomUUID().replaceAll('-', '')}`;
  const Project = connection.model('ProcurementQueryTest', ProjectSchema, collection);
  const now = new Date('2026-10-05T10:00:00+07:00');
  const base = {
    source: 'bangkok-egp', procurementMethod: 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)', status: 'Public', classification: 'software', dataVerified: true,
    sourceVerifiedAt: now, procurementStatus: 'open', deadlinePrecision: 'datetime', deadline: new Date('2026-10-06T12:00:00+07:00'),
    analysisStatus: 'completed', descriptions: 'AI summary', budget: 1000, announcedAt: new Date('2026-10-01T00:00:00+07:00'),
    aiAnalysis: { fieldResults: { budget: { status: 'found' }, announcedAt: { status: 'found' }, deadline: { status: 'found' } } },
    documents: [{ kind: 'tor', title: 'Test fixture only', url: 'https://example.org/fixture.pdf', verifiedAt: now }],
  };
  const cases = [
    ['open', {}], ['expired', { deadline: now }], ['awarded', { procurementStatus: 'awarded' }],
    ['tero-open', { source: 'tero-procurement' }], ['gov-open', { source: 'govspending' }],
    ['cancelled', { procurementStatus: 'cancelled' }], ['draft', { status: 'Draft' }],
    ['unverified', { dataVerified: false }], ['missing-tor', { documents: [] }],
    ['unknown', { deadline: null }], ['stale', { sourceVerifiedAt: new Date('2026-10-01') }],
    ['pending-analysis', { analysisStatus: 'pending' }], ['no-summary', { descriptions: '' }],
    ['no-budget', { budget: null }], ['no-publication', { announcedAt: null }],
    ['uncited-budget', { aiAnalysis: { fieldResults: { budget: { status: 'not_found' }, announcedAt: { status: 'found' }, deadline: { status: 'found' } } } }],
    ['other-source', { source: 'gprocurement' }], ['other-method', { procurementMethod: 'เฉพาะเจาะจง' }],
  ];
  try {
    await Project.insertMany(cases.map(([title, patch], index) => ({ ...base, ...patch, title, externalId: String(index) })));
    // Direct postings (FR-13) have no TOR documents or AI fields; only the publisher's deadline and status gate them.
    const posting = { source: 'direct', procurementMethod: 'Direct posting', status: 'Public', classification: 'software', procurementStatus: 'open',
      publisherId: new mongoose.Types.ObjectId(), budget: 5000, deadlinePrecision: 'datetime', deadline: new Date('2026-10-06T12:00:00+07:00'), analysisStatus: 'skipped' };
    await Project.insertMany([['direct-open', {}], ['direct-expired', { deadline: now }], ['direct-closed', { procurementStatus: 'closed' }],
      ['direct-no-budget', { budget: null }]].map(([title, patch]) => ({ ...posting, ...patch, title, externalId: `TMX-${title}` })));
    for (const params of [{}, { deadlineYear: '2569' }, { deadlineFrom: '2026-10-01', deadlineTo: '2026-10-31' }]) {
      const { query } = await buildProjectQuery(params, async () => [], now);
      assert.deepEqual((await Project.find(query).lean()).map(p => p.title).sort(), ['direct-open', 'gov-open', 'open', 'tero-open']);
    }
    const direct = await buildProjectQuery({ origin: 'direct' }, async () => [], now);
    assert.deepEqual((await Project.find(direct.query).lean()).map(p => p.title), ['direct-open']);
    const government = await buildProjectQuery({ origin: 'government', method: 'e-bidding' }, async () => [], now);
    assert.deepEqual((await Project.find(government.query).lean()).map(p => p.title).sort(), ['gov-open', 'open', 'tero-open']);
    const searched = await buildProjectQuery({ availability: 'open', search: 'unknown' }, async () => [], now);
    assert.deepEqual((await Project.find(searched.query).lean()).map(p => p.title), []);
    const dated = await buildProjectQuery({ availability: 'open', deadlineYear: '2569' }, async () => [], now);
    assert.deepEqual((await Project.find(dated.query).lean()).map(p => p.title).sort(), ['direct-open', 'gov-open', 'open', 'tero-open']);
    const oldYear = await buildProjectQuery({ deadlineYear: '2568' }, async () => [], now);
    assert.equal(await Project.countDocuments(oldYear.query), 0);
    await Project.insertMany([
      { ...base, title: 'date-only-today', externalId: 'date-today', deadlinePrecision: 'date', deadline: new Date('2026-10-05T00:00:00Z') },
      { ...base, title: 'date-only-yesterday', externalId: 'date-yesterday', deadlinePrecision: 'unknown', deadline: new Date('2026-10-04T00:00:00Z') },
    ]);
    const today = await buildProjectQuery({ availability: 'open', search: 'date-only' }, async () => [], now);
    assert.deepEqual((await Project.find(today.query).lean()).map(p => p.title), ['date-only-today']);
  } finally {
    await connection.db.collection(collection).drop().catch(error => { if (error.code !== 26) throw error; });
    await connection.close();
  }
});
