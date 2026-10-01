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

test('blank search browses all records; Thai and object IDs work', async () => {
  assert.deepEqual(await buildProjectQuery({ search: '  ', page: '2', limit: '20' }, () => assert.fail()), { query: {}, page: 2, limit: 20 });
  const thai = await buildProjectQuery({ search: 'ระบบ' }, async () => []);
  assert.ok(new RegExp(thai.query.$or[0].title.$regex).test('พัฒนาระบบ'));
  const id = '6ab810a26f45fc8204377cbf';
  const result = await buildProjectQuery({ search: id }, async () => []);
  assert.ok(result.query.$or.some(clause => clause._id === id));
});

test('agency and budget filters combine, including a zero budget', async () => {
  const { query } = await buildProjectQuery({ agency: 'Dept. A', minBudget: '0', maxBudget: '1000' }, async () => []);
  assert.deepEqual(query.budget, { $gte: 0, $lte: 1000 });
  const agency = new RegExp(query.agency.$regex, query.agency.$options);
  assert.ok(agency.test('dept. A'));
  assert.ok(!agency.test('DeptX A'));
});

test('rejects malformed filters and unsafe pagination', async () => {
  for (const params of [{ search: { $ne: '' } }, { page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' }, { minBudget: 'NaN' }, { minBudget: '-1' }, { minBudget: '5', maxBudget: '0' }, { deadline: 'invalid' }, { search: 'x'.repeat(301) }]) await assert.rejects(buildProjectQuery(params, async () => []), { status: 400 });
});
