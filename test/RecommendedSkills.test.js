const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const Skill = require('../src/models/Skill');
const { RECOMMENDED_SKILL_GROUPS, recommendedSkillGroups, extractionVocabulary, seedRecommendedSkills } = require('../src/services/RecommendedSkills');
const { resolveSkills, calculateMatch } = require('../src/services/SkillMatching');

test('recommendations reuse existing catalog spelling and IDs without merging distinct duties', () => {
  const vocabulary = [
    { name: 'software maintenance', _id: 'maintenance' },
    { name: 'Database Backup', _id: 'backup' },
    { name: 'Database Recovery', _id: 'recovery' },
    { name: 'Database Backup and Recovery', _id: 'combined' },
    { name: 'Network Maintenance', _id: 'network' },
    { name: 'Network Security', _id: 'security' },
  ];
  const names = recommendedSkillGroups(vocabulary).flatMap(group => group.skills);
  assert.ok(names.includes('software maintenance'));
  assert.ok(!names.includes('Software Maintenance'));
  const mapped = resolveSkills(['Software Maintenance', 'Database Backup', 'Database Recovery', 'Network Maintenance', 'Network Security'], vocabulary);
  assert.deepEqual(mapped.requiredSkills, ['maintenance', 'backup', 'recovery', 'network', 'security']);
  assert.equal(calculateMatch({ analysisStatus: 'completed', requiredSkills: mapped.requiredSkills }, ['maintenance','backup']).matchPercentage, 40);
  assert.deepEqual(resolveSkills(['Database Backup'], vocabulary).requiredSkills, ['backup']);
});

test('seeding requests every unique curated name and retains specialist vocabulary', async () => {
  const resolved = [];
  await seedRecommendedSkills(async name => resolved.push(name));
  assert.equal(new Set(resolved.map(name => name.toLowerCase())).size, resolved.length);
  assert.ok(resolved.includes('Python'));
  assert.ok(resolved.includes('Software Maintenance'));
  assert.ok(resolved.includes('Database Backup and Recovery'));
  assert.ok(resolved.every(name => name.length <= 60));
  assert.equal(RECOMMENDED_SKILL_GROUPS.length, 6);
  assert.ok(extractionVocabulary([{name: 'Specialist PLC Diagnostics'}]).includes('Specialist PLC Diagnostics'));
});

test('recommendations endpoint is public and reads catalog names without writing', async t => {
  t.mock.method(Skill, 'find', () => ({ select: () => ({ lean: async () => [{name:'software maintenance'}] }) }));
  t.mock.method(Skill, 'create', () => assert.fail('GET must not create skills'));
  const app = express();
  app.use('/api/skills', require('../src/routes/skill'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/skills/recommendations`);
    assert.equal(response.status, 200);
    const groups = await response.json();
    assert.equal(groups.length, 6);
    assert.ok(groups[0].skills.includes('software maintenance'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
