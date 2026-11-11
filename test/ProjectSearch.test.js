const test = require('node:test');
const assert = require('node:assert/strict');
const { buildProjectQuery } = require('../src/services/ProjectSearch');
// Eligibility is query.$and[0].$or: [verified government e-bidding TORs, open direct postings].
const branches = query => query.$and[0].$or;

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
  const [government, direct] = branches(browse.query);
  assert.equal(government.status, 'Public');
  assert.ok(government.source.$in.includes('tero-procurement'));
  assert.equal(government.procurementMethod.$regex, 'e-bidding');
  assert.equal(government.procurementStatus, 'open');
  assert.equal(government.dataVerified, true);
  assert.equal(government.analysisStatus, 'completed');
  assert.deepEqual(government.budget, { $type: 'number', $gt: 0 });
  assert.equal(government['aiAnalysis.fieldResults.announcedAt.status'], 'found');
  assert.equal(government.$and[0].$or[0].deadline.$gt, now);
  assert.equal(government.documents.$elemMatch.kind, 'tor');
  // Direct postings skip TOR verification and the e-bidding method, but must be public, open and unexpired.
  assert.equal(direct.source, 'direct');
  assert.equal(direct.status, 'Public');
  assert.equal(direct.procurementStatus, 'open');
  assert.equal(direct.procurementMethod, undefined);
  assert.equal(direct.deadline.$gt, now);
  assert.deepEqual(direct.budget, { $type: 'number', $gt: 0 });
  const thai = await buildProjectQuery({ search: 'ระบบ' }, async () => []);
  assert.ok(new RegExp(thai.query.$or[0].title.$regex).test('พัฒนาระบบ'));
  const id = '6ab810a26f45fc8204377cbf';
  const result = await buildProjectQuery({ search: id }, async () => []);
  assert.ok(result.query.$or.some(clause => clause._id === id));
});

test('Buddhist closing-year filter uses Bangkok year boundaries and cannot reveal expired bids', async () => {
  const now = new Date('2026-10-05T08:00:00+07:00');
  const { query } = await buildProjectQuery({ deadlineYear: '2569' }, async () => [], now);
  assert.equal(branches(query)[0].$and[0].$or[0].deadline.$gt, now);
  assert.equal(branches(query)[1].deadline.$gt, now);
  assert.equal(query.deadline.$gte.toISOString(), '2025-12-31T17:00:00.000Z');
  assert.equal(query.deadline.$lte.toISOString(), '2026-12-31T16:59:59.999Z');
  const range = await buildProjectQuery({ deadlineYear: '2569', deadlineFrom: '2026-10-06', deadlineTo: '2026-10-07' }, async () => [], now);
  assert.equal(range.query.deadline.$gte.toISOString(), '2026-10-05T17:00:00.000Z');
  assert.equal(range.query.deadline.$lte.toISOString(), '2026-10-07T16:59:59.999Z');
});

test('search rejects unknown or expired availability and malformed filters', async () => {
  for (const params of [{ status: 'Draft' }, { availability: 'all' }, { availability: 'unknown' }, { availability: 'closed' }, { sort: 'bad' }, { deadlineYear: 'NaN' }, { deadlineFrom: '2026-02-30' }, { deadlineFrom: '2026-10-08', deadlineTo: '2026-10-07' }, { priceFlag: 'Weird' }, { origin: 'elsewhere' }]) await assert.rejects(buildProjectQuery(params, async () => []), { status: 400 });
});

test('agency and budget filters combine, including a zero budget', async () => {
  const { query } = await buildProjectQuery({ agency: 'Dept. A', minBudget: '0', maxBudget: '1000' }, async () => []);
  assert.deepEqual(query.budget, { $gte: 0, $lte: 1000 });
  for (const branch of branches(query)) assert.deepEqual(branch.budget, { $type: 'number', $gt: 0 });
  const agency = new RegExp(query.agency.$regex, query.agency.$options);
  assert.ok(agency.test('dept. A'));
  assert.ok(!agency.test('DeptX A'));
});

test('a method filter cannot widen the feed beyond verified IT e-bidding', async () => {
  const { query } = await buildProjectQuery({ method: 'เฉพาะเจาะจง' }, async () => []);
  const [government] = branches(query);
  assert.ok(government.source.$in.includes('govspending'));
  assert.equal(government.procurementMethod.$regex, 'e-bidding');
  assert.ok(query.$and.some(part => part.procurementMethod));
});

test('rejects malformed filters and unsafe pagination', async () => {
  for (const params of [{ search: { $ne: '' } }, { page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' }, { minBudget: 'NaN' }, { minBudget: '-1' }, { minBudget: '5', maxBudget: '0' }, { deadline: 'invalid' }, { search: 'x'.repeat(301) }]) await assert.rejects(buildProjectQuery(params, async () => []), { status: 400 });
});

test('origin filter separates direct postings from government TORs', async () => {
  const direct = await buildProjectQuery({ origin: 'direct' }, async () => []);
  assert.equal(direct.query.source, 'direct');
  const government = await buildProjectQuery({ origin: 'government' }, async () => []);
  assert.deepEqual(government.query.source, { $ne: 'direct' });
  const flagged = await buildProjectQuery({ priceFlag: 'ScopeMismatch' }, async () => []);
  assert.equal(flagged.query.priceFlag, 'ScopeMismatch');
});

test('NFR-09: skill filter matches catalog, AI-extracted and publisher skill names alongside search', async () => {
  // The catalog lookup runs for both the text search and the skill filter; only "React" is a skill.
  const { query } = await buildProjectQuery({ skill: ' React ', search: 'portal' }, async regex =>
    new RegExp(regex.$regex, regex.$options).test('react') ? ['react-id'] : []);
  assert.ok(query.$or.some(clause => clause.title), 'text search stays separate');
  const skill = query.$and.find(part => part.$or?.some(clause => clause.sourceSkillNames));
  assert.ok(skill.$or.some(clause => clause['aiAnalysis.mandatorySkillNames']));
  assert.deepEqual(skill.$or.at(-1), { requiredSkills: { $in: ['react-id'] } });
  await assert.rejects(buildProjectQuery({ skill: 'x'.repeat(61) }, async () => []), { status: 400 });
});
