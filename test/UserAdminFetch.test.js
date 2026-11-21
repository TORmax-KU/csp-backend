const test = require("node:test");
const assert = require("node:assert/strict");
const User = require("../src/models/User");
const { fetch } = require("../controllers/UserController");

const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const chain = (rows) => ({ select: () => ({ sort: () => ({ skip: () => ({ limit: async () => rows }) }) }) });

test("admin user list rejects a non-string role/status (NoSQL injection attempt)", async t => {
  const res1 = response();
  await fetch({ query: { role: { $ne: "Admin" } } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = response();
  await fetch({ query: { status: { $gt: "" } } }, res2);
  assert.equal(res2.statusCode, 400);
});

test("admin user list rejects a role/status outside the allowed values", async t => {
  const res1 = response();
  await fetch({ query: { role: "SuperAdmin" } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = response();
  await fetch({ query: { status: "Pending" } }, res2);
  assert.equal(res2.statusCode, 400);
});

test("admin user list filters by role and status", async t => {
  const rows = [{ _id: "u1", role: "Vendor", status: "Active" }];
  t.mock.method(User, "find", () => chain(rows));
  t.mock.method(User, "countDocuments", async () => 1);
  const res = response();
  await fetch({ query: { role: "Vendor", status: "Active" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { users: rows, total: 1, page: 1, limit: 10 });
});
