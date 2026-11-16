const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const User = require("../src/models/User");
const matching = require("../src/services/MatchingEngine");

test("profile API saves four booleans, reruns matching, rejects malformed values and denies another account", async t => {
  const owner = "012345678901234567890123";
  const user = new User({ _id: owner, email: "vendor@example.test" });
  const rematches = [];
  let writes = 0;
  t.mock.method(matching, "runMatching", async args => { rematches.push(args); });
  t.mock.method(User, "findById", () => ({ then: resolve => Promise.resolve(user).then(resolve), populate: async () => user }));
  t.mock.method(User, "findByIdAndUpdate", (id, patch, options) => {
    assert.equal(id, owner);
    assert.equal(options.runValidators, true);
    writes++;
    user.set(patch);
    return { populate: async () => user };
  });
  // Controller captures runMatching at module load, so load after installing its mock.
  const routes = require("../src/routes/user");
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => true; next(); });
  app.use("/api/users", routes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/users`;
  const patch = (id, body) => fetch(`${base}/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const preferences = { notifyMatchesInApp: false, notifyMatchesEmail: true,
      notifyHighBudgetInApp: true, notifyHighBudgetEmail: false, matchThreshold: 50 };
    const response = await patch(owner, preferences);
    assert.equal(response.status, 200);
    const saved = await response.json();
    for (const [key, value] of Object.entries(preferences)) assert.equal(saved[key], value);
    assert.equal(rematches.length, 1);
    assert.equal(String(rematches[0].userIds[0]), owner);
    const loaded = await (await fetch(`${base}/${owner}`)).json();
    assert.equal(loaded.notifyMatchesEmail, true);
    for (const value of ["false", 1, null, {}, []]) {
      assert.equal((await patch(owner, { notifyMatchesEmail: value })).status, 400);
    }
    assert.equal((await patch("112345678901234567890123", preferences)).status, 403);
    assert.equal(writes, 1);
    assert.equal(rematches.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
