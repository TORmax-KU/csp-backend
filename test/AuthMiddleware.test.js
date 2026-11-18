const test = require("node:test");
const assert = require("node:assert/strict");
const isAuthenticated = require("../src/middleware/isAuthenticated");
const isAdmin = require("../src/middleware/isAdmin");

function run(middleware, user) {
  const req = { user, isAuthenticated: () => Boolean(user) };
  const res = {
    statusCode: 200, body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });
  return { res, nextCalled };
}

test("isAuthenticated passes signed-in users through and rejects anonymous ones with 401", () => {
  const signedIn = run(isAuthenticated, { _id: "u1", role: "User" });
  assert.equal(signedIn.nextCalled, true);
  assert.equal(signedIn.res.statusCode, 200);

  const anonymous = run(isAuthenticated, undefined);
  assert.equal(anonymous.nextCalled, false);
  assert.equal(anonymous.res.statusCode, 401);
  assert.deepEqual(anonymous.res.body, { message: "Not authenticated" });
});

test("isAdmin returns 401 for anonymous, 403 for non-admins, and lets admins through", () => {
  const anonymous = run(isAdmin, undefined);
  assert.equal(anonymous.res.statusCode, 401);
  assert.equal(anonymous.nextCalled, false);

  for (const role of ["User", "Publisher", "admin", undefined]) {
    const regular = run(isAdmin, { _id: "u2", role });
    assert.equal(regular.res.statusCode, 403, `role ${role} must not pass`);
    assert.equal(regular.nextCalled, false);
  }

  const admin = run(isAdmin, { _id: "u3", role: "Admin" });
  assert.equal(admin.nextCalled, true);
  assert.equal(admin.res.statusCode, 200);
});
