const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectQuery } = require('../src/services/ProjectSearch');

test('search treats punctuation literally and searches summaries, IDs and skills', async () => {
  const { query } = await buildProjectQuery({ search: ' C++ (cloud).* ' }, async regex => {
    const pattern = new RegExp(regex.$regex, regex.$options);
    assert.ok(pattern.test('Required: C++ (cloud).*'));
    assert.ok(!pattern.test('CCCC cloud anything'));
    return ['skill-id'];
  });
  for (const field of ['title', 'agency', 'description', 'descriptions', 'externalId', 'aiAnalysis.mandatorySkillNames']) assert.ok(query.$or.some(clause => clause[field]));
  assert.deepEqual(query.$or.at(-1), { requiredSkills: { $in: ['skill-id'] } });
});

test('blank search only browses verified open procurement; Thai and object IDs work', async () => {
  const now = new Date('2026-10-05T08:00:00+07:00');
  const browse = await buildProjectQuery({ search: '  ', page: '2', limit: '20' }, () => assert.fail(), now);
  assert.equal(browse.page, 2);
  assert.equal(browse.limit, 20);
  assert.equal(browse.query.status, 'Public');
  assert.ok(browse.query.source.$in.includes('tero-procurement'));
  assert.equal(browse.query.procurementMethod.$regex, 'e-bidding');
  assert.equal(browse.query.procurementStatus, 'open');
  assert.equal(browse.query.dataVerified, true);
  assert.equal(browse.query.analysisStatus, 'completed');
  assert.deepEqual(browse.query.budget, { $type: 'number', $gt: 0 });
  assert.equal(browse.query['aiAnalysis.fieldResults.announcedAt.status'], 'found');
  assert.equal(browse.query.$and[0].$or[0].deadline.$gt, now);
  assert.equal(browse.query.documents.$elemMatch.kind, 'tor');
  const thai = await buildProjectQuery({ search: 'ระบบ' }, async () => []);
  assert.ok(new RegExp(thai.query.$or[0].title.$regex).test('พัฒนาระบบ'));
  const id = '6ab810a26f45fc8204377cbf';
  const result = await buildProjectQuery({ search: id }, async () => []);
  assert.ok(result.query.$or.some(clause => clause._id === id));
});

test('Buddhist closing-year filter uses Bangkok year boundaries and cannot reveal expired bids', async () => {
  const now = new Date('2026-10-05T08:00:00+07:00');
  const { query } = await buildProjectQuery({ deadlineYear: '2569' }, async () => [], now);
  assert.equal(query.$and[0].$or[0].deadline.$gt, now);
  assert.equal(query.deadline.$gte.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(query.deadline.$lte.toISOString(), '2026-12-31T16:59:59.999Z');
  const range = await buildProjectQuery({ deadlineYear: '2569', deadlineFrom: '2026-10-06', deadlineTo: '2026-10-07' }, async () => [], now);
  assert.equal(range.query.deadline.$gte.toISOString(), '2026-10-05T17:00:00.000Z');
  assert.equal(range.query.deadline.$lte.toISOString(), '2026-10-07T16:59:59.999Z');
});

test('search rejects unknown or expired availability and malformed filters', async () => {
  for (const params of [{ status: 'Draft' }, { availability: 'all' }, { availability: 'unknown' }, { availability: 'closed' }, { sort: 'bad' }, { deadlineYear: 'NaN' }, { deadlineFrom: '2026-02-30' }, { deadlineFrom: '2026-10-08', deadlineTo: '2026-10-07' }]) await assert.rejects(buildProjectQuery(params, async () => []), { status: 400 });
});

test('agency and budget filters combine, including a zero budget', async () => {
  const { query } = await buildProjectQuery({ agency: 'Dept. A', minBudget: '0', maxBudget: '1000' }, async () => []);
  assert.deepEqual(query.budget, { $type: 'number', $gt: 0, $gte: 0, $lte: 1000 });
  const agency = new RegExp(query.agency.$regex, query.agency.$options);
  assert.ok(agency.test('dept. A'));
  assert.ok(!agency.test('DeptX A'));
});

test('a method filter cannot widen the feed beyond verified IT e-bidding', async () => {
  const { query } = await buildProjectQuery({ method: 'เฉพาะเจาะจง' }, async () => []);
  assert.ok(query.source.$in.includes('govspending'));
  assert.equal(query.procurementMethod.$regex, 'e-bidding');
  assert.ok(query.$and.some(part => part.procurementMethod));
});

test('rejects malformed filters and unsafe pagination', async () => {
  for (const params of [{ search: { $ne: '' } }, { page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' }, { minBudget: 'NaN' }, { minBudget: '-1' }, { minBudget: '5', maxBudget: '0' }, { deadline: 'invalid' }, { search: 'x'.repeat(301) }]) await assert.rejects(buildProjectQuery(params, async () => []), { status: 400 });
});
