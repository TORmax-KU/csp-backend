const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { randomUUID } = require('node:crypto');
const { ProjectSchema } = require('../schemas/ProjectModel');
const { buildProjectQuery } = require('../src/services/ProjectSearch');

test('MongoDB excludes expired, terminal, unverified and missing-TOR records across filters', { skip: !process.env.TEST_MONGO_URI }, async () => {
  const connection = await mongoose.createConnection(process.env.TEST_MONGO_URI).asPromise();
  const collection = `procurement_test_${randomUUID().replaceAll('-', '')}`;
  const Project = connection.model('ProcurementQueryTest', ProjectSchema, collection);
  const now = new Date('2026-10-05T10:00:00+07:00');
  const base = {
    source: 'gprocurement', status: 'Public', classification: 'software', dataVerified: true,
    sourceVerifiedAt: now, procurementStatus: 'open', deadline: new Date('2026-10-06T12:00:00+07:00'),
    documents: [{ kind: 'tor', title: 'Test fixture only', url: 'https://example.org/fixture.pdf', verifiedAt: now }],
  };
  const cases = [
    ['open', {}], ['expired', { deadline: now }], ['awarded', { procurementStatus: 'awarded' }],
    ['cancelled', { procurementStatus: 'cancelled' }], ['draft', { status: 'Draft' }],
    ['unverified', { dataVerified: false }], ['missing-tor', { documents: [] }],
    ['unknown', { deadline: null }], ['stale', { sourceVerifiedAt: new Date('2026-10-01') }],
    ['old-source', { source: 'bangkok-egp' }],
  ];
  try {
    await Project.insertMany(cases.map(([title, patch], index) => ({ ...base, ...patch, title, externalId: String(index) })));
    for (const params of [{}, { deadlineYear: '2569' }, { deadlineFrom: '2026-10-01', deadlineTo: '2026-10-31' }]) {
      const { query } = await buildProjectQuery(params, async () => [], now);
      assert.deepEqual((await Project.find(query).lean()).map(p => p.title), ['open']);
    }
    const unknown = await buildProjectQuery({ availability: 'unknown' }, async () => [], now);
    assert.deepEqual((await Project.find(unknown.query).lean()).map(p => p.title), ['unknown']);
    const oldYear = await buildProjectQuery({ deadlineYear: '2568' }, async () => [], now);
    assert.equal(await Project.countDocuments(oldYear.query), 0);
  } finally {
    await connection.db.collection(collection).drop().catch(error => { if (error.code !== 26) throw error; });
    await connection.close();
  }
});
