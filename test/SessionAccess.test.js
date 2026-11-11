const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
// Install a test Google strategy without contacting Google.
process.env.GOOGLE_CLIENT_ID = "test-client";
process.env.GOOGLE_CLIENT_SECRET = "test-secret";
const passport = require("../src/config/passport");
const User = require("../src/models/User");
const { setUserStatus } = require("../controllers/AdminController");

test("disabling revokes existing sessions, including untouched sessions after reactivation", async t => {
  const user = new User({ email: "session@example.com" });
  t.mock.method(User, "findById", async () => user);
  t.mock.method(User, "findByIdAndUpdate", async (id, patch) => {
    assert.equal(id, user.id);
    user.status = patch.$set.status;
    user.sessionVersion += patch.$inc?.sessionVersion ?? 0;
    return user;
  });
  const app = express();
  const store = new session.MemoryStore();
  app.use(session({ secret: "test", store, resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.post("/login", (req, res, next) => req.login(user, err => err ? next(err) : res.sendStatus(200)));
  app.post("/legacy-login", (req, res) => { req.session.passport = { user: user.id }; res.sendStatus(200); });
  app.get("/me", (req, res) => res.sendStatus(req.isAuthenticated() ? 200 : 401));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (path = "/login") => (await fetch(base + path, { method: "POST" })).headers.get("set-cookie").split(";")[0];
  const me = cookie => fetch(base + "/me", { headers: { cookie } });
  const first = await login();
  const untouched = await login();
  const legacy = await login("/legacy-login");
  assert.equal((await me(first)).status, 200);
  assert.equal((await me(legacy)).status, 200);
  const changeStatus = async status => {
    let code;
    await setUserStatus({ params: { id: user.id }, body: { status } },
      { status(value) { code = value; return this; }, json() {} });
    assert.equal(code, 200);
  };
  await changeStatus("Disabled");
  assert.equal(user.sessionVersion, 1);
  assert.equal((await me(first)).status, 401);
  await changeStatus("Active");
  assert.equal((await me(untouched)).status, 401);
  assert.equal((await me(legacy)).status, 401);
  assert.equal((await me(await login())).status, 200);
});

test("Google sign-in rejects disabled accounts", async t => {
  const user = new User({ email: "disabled@example.com", googleId: "g1", status: "Disabled" });
  t.mock.method(User, "findOne", async () => user);
  const result = await new Promise((resolve, reject) => {
    passport._strategy("google")._verify("token", "refresh", {
      id: "g1", emails: [{ value: user.email, verified: true }],
    }, (error, identity) => error ? reject(error) : resolve(identity));
  });
  assert.equal(result, false);
});
