const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const passport = require("../src/config/passport");
const User = require("../src/models/User");
const authRoutes = require("../src/routes/auth");

// In-memory stand-in for the users collection so the test needs no MongoDB.
const stubUsers = (t, users) => {
  const find = (filter) => users.find(u => (filter.email ? u.email === filter.email : u.id === filter));
  t.mock.method(User, "exists", async (filter) => (find(filter) ? { _id: find(filter)._id } : null));
  t.mock.method(User, "findOne", (filter) => ({ select: async () => find(filter) || null }));
  t.mock.method(User, "findById", async (id) => find(String(id)) || null);
  t.mock.method(User, "create", async (data) => {
    const user = new User(data);
    users.push(user);
    return user;
  });
};

const startApp = async () => {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use(passport.initialize());
  app.use(passport.session());
  app.use("/auth", authRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/auth` };
};

const post = (url, body) => fetch(url, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("register validates input, hashes the password and starts a session", async (t) => {
  const users = [];
  stubUsers(t, users);
  const { server, base } = await startApp();
  try {
    assert.equal((await post(`${base}/register`, { email: "nope", password: "longenough" })).status, 400);
    assert.equal((await post(`${base}/register`, { email: "a@b.co", password: "short" })).status, 400);
    assert.equal((await post(`${base}/register`, { email: "a@b.co", password: "x".repeat(73) })).status, 400);
    assert.equal((await post(`${base}/register`, { email: "a@b.co", password: "longenough", role: "Admin" })).status, 400);
    assert.equal(users.length, 0);

    const res = await post(`${base}/register`, { email: " Vendor@Example.com ", password: "correct horse", role: "JobLister" });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.email, "vendor@example.com");
    assert.equal(body.role, "JobLister");
    assert.equal(body.passwordHash, undefined);
    assert.ok(await bcrypt.compare("correct horse", users[0].passwordHash));

    const me = await fetch(`${base}/me`, { headers: { cookie: res.headers.get("set-cookie").split(";")[0] } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).email, "vendor@example.com");

    assert.equal((await post(`${base}/register`, { email: "vendor@example.com", password: "another one" })).status, 409);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("login rejects bad credentials and disabled accounts without revealing which", async (t) => {
  const passwordHash = await bcrypt.hash("correct horse", 4);
  const users = [
    new User({ email: "active@example.com", passwordHash }),
    new User({ email: "disabled@example.com", passwordHash, status: "Disabled" }),
    new User({ email: "google@example.com", googleId: "g-1" }),
  ];
  stubUsers(t, users);
  const { server, base } = await startApp();
  try {
    assert.equal((await post(`${base}/login`, { email: "active@example.com" })).status, 400);

    const wrong = await post(`${base}/login`, { email: "active@example.com", password: "wrong password" });
    const unknown = await post(`${base}/login`, { email: "nobody@example.com", password: "correct horse" });
    const googleOnly = await post(`${base}/login`, { email: "google@example.com", password: "correct horse" });
    for (const res of [wrong, unknown, googleOnly]) {
      assert.equal(res.status, 401);
      assert.equal((await res.json()).message, "Invalid email or password");
      assert.equal(res.headers.get("set-cookie"), null);
    }

    assert.equal((await post(`${base}/login`, { email: "disabled@example.com", password: "correct horse" })).status, 403);

    const ok = await post(`${base}/login`, { email: "ACTIVE@example.com", password: "correct horse" });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).passwordHash, undefined);
    assert.ok(ok.headers.get("set-cookie"));
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
