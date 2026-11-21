const test = require("node:test");
const assert = require("node:assert/strict");
const sanitizeInput = require("../src/middleware/sanitizeInput");

const run = (body, query, params) => {
  const req = { body, query, params };
  let calledNext = false;
  sanitizeInput(req, {}, () => { calledNext = true; });
  assert.ok(calledNext, "next() must always be called");
  return req;
};

test("strips top-level NoSQL operator keys from query/body/params", () => {
  const req = run({ status: { $ne: null } }, { status: { $gt: "" } }, { id: { $where: "1==1" } });
  assert.deepEqual(req.body, { status: {} });
  assert.deepEqual(req.query, { status: {} });
  assert.deepEqual(req.params, { id: {} });
});

test("strips dotted keys and recurses into nested objects and arrays", () => {
  const req = run({ filters: [{ "a.b": 1 }, { ok: "yes" }] }, {}, {});
  assert.deepEqual(req.body, { filters: [{}, { ok: "yes" }] });
});

test("leaves ordinary values untouched", () => {
  const req = run({ email: "a@b.com", age: 30 }, { page: "2" }, { id: "abc" });
  assert.deepEqual(req.body, { email: "a@b.com", age: 30 });
  assert.deepEqual(req.query, { page: "2" });
  assert.deepEqual(req.params, { id: "abc" });
});

test("tolerates missing body/query/params", () => {
  const req = { query: { ok: true } };
  let calledNext = false;
  sanitizeInput(req, {}, () => { calledNext = true; });
  assert.ok(calledNext);
  assert.deepEqual(req.query, { ok: true });
});
