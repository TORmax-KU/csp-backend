const test = require('node:test');
const assert = require('node:assert/strict');
const { parseQualificationNumbers } = require('../controllers/UserController');

test('budget range, team size and capacity are saved when valid', () => {
  const { patch } = parseQualificationNumbers({ minBudget: 500000, maxBudget: 5000000, teamSize: 12, capacity: 3 }, {});
  assert.deepEqual(patch, { minBudget: 500000, maxBudget: 5000000, teamSize: 12, capacity: 3 });
  assert.deepEqual(parseQualificationNumbers({ maxBudget: null, teamSize: '' }, { minBudget: 1 }).patch, { maxBudget: null, teamSize: null });
});

test('negative, fractional and non-numeric values are rejected', () => {
  for (const body of [{ minBudget: -1 }, { teamSize: 2.5 }, { capacity: '3' }, { maxBudget: Infinity }, { teamSize: true }]) {
    assert.ok(parseQualificationNumbers(body, {}).error, JSON.stringify(body));
  }
});

test('the budget range is checked against the saved value it is not changing', () => {
  assert.match(parseQualificationNumbers({ minBudget: 10 }, { maxBudget: 5 }).error, /cannot exceed/);
  assert.match(parseQualificationNumbers({ minBudget: 10, maxBudget: 5 }, {}).error, /cannot exceed/);
  assert.equal(parseQualificationNumbers({ maxBudget: null }, { minBudget: 10 }).error, undefined);
});
