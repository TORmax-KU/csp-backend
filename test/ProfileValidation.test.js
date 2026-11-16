const test = require("node:test");
const assert = require("node:assert/strict");
const { validateProfilePatch } = require("../src/services/ProfileValidation");
const { validatePosting } = require("../src/services/DirectPosting");

test("partial profile updates validate merged budget ranges, nulls, whole counts and strict numeric types", () => {
  const existing = { minBudget: 100, maxBudget: 1000 };
  assert.ok(validateProfilePatch({ minBudget: 2000 }, existing).minBudget);
  assert.ok(validateProfilePatch({ maxBudget: 50 }, existing).maxBudget);
  assert.deepEqual(validateProfilePatch({ minBudget: null, maxBudget: 50 }, existing), {});
  for (const field of ["teamSize", "capacity", "yearsInBusiness", "matchThreshold"]) {
    assert.ok(validateProfilePatch({ [field]: 50.5 }, existing)[field]);
  }
  for (const value of ["100", true, [], {}, -1]) assert.ok(validateProfilePatch({ minBudget: value }, existing).minBudget);
  assert.ok(validateProfilePatch({ matchThreshold: null }, existing).matchThreshold);
  assert.deepEqual(validateProfilePatch({ teamSize: null, capacity: 0, matchThreshold: 50 }, existing), {});
});

test("malformed contact fields and boolean budgets produce posting validation errors instead of exceptions", () => {
  for (const contact of [{ name: 123, email: 123 }, { name: {}, phone: [] }, []]) {
    const result = validatePosting({ contact, budget: true });
    assert.ok(result.errors.budget);
    assert.ok(Object.keys(result.errors).some(key => key.startsWith("contact.")));
  }
});
