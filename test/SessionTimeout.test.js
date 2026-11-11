const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");
const { sessionOptions, idleTimeout, SESSION_IDLE_MS, BACKGROUND_HEADER } = require("../src/config/session");

const MINUTE = 60 * 1000;
const expiresAt = header => new Date(/Expires=([^;]+)/.exec(header || "")?.[1]).getTime();

async function startApp() {
  const app = express();
  app.use(session(sessionOptions({ store: new session.MemoryStore(), env: { SESSION_SECRET: "test-secret" } })));
  app.use(idleTimeout());
  // Same shape passport stores on login.
  app.post("/login", (req, res) => { req.session.passport = { user: "u1" }; res.json({ ok: true }); });
  app.get("/me", (req, res) => res.status(req.session.passport?.user ? 200 : 401).json({}));
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

test("NFR-07: sessions expire after 2 hours idle, and activity restarts the window", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-11T08:00:00Z") });
  const { server, base } = await startApp();
  t.after(() => new Promise(resolve => server.close(resolve)));

  const login = await fetch(`${base}/login`, { method: "POST" });
  const setCookie = login.headers.get("set-cookie");
  assert.equal(expiresAt(setCookie), Date.now() + SESSION_IDLE_MS);
  assert.match(setCookie, /HttpOnly/);
  const cookie = setCookie.split(";")[0];
  const me = () => fetch(`${base}/me`, { headers: { cookie } });
  await me(); // first authenticated request records activity

  // Active use keeps the session alive well past 2 hours in total.
  t.mock.timers.tick(SESSION_IDLE_MS - MINUTE);
  const active = await me();
  assert.equal(active.status, 200);
  assert.equal(expiresAt(active.headers.get("set-cookie")), Date.now() + SESSION_IDLE_MS, "each response pushes expiry 2 hours out");
  t.mock.timers.tick(SESSION_IDLE_MS - MINUTE);
  assert.equal((await me()).status, 200);

  // Two idle hours end it.
  t.mock.timers.tick(SESSION_IDLE_MS + MINUTE);
  assert.equal((await me()).status, 401);
});

test("NFR-07: background polling does not keep an unattended session alive", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-11T08:00:00Z") });
  const { server, base } = await startApp();
  t.after(() => new Promise(resolve => server.close(resolve)));
  const cookie = (await fetch(`${base}/login`, { method: "POST" })).headers.get("set-cookie").split(";")[0];
  const poll = () => fetch(`${base}/me`, { headers: { cookie, [BACKGROUND_HEADER]: "1" } });
  assert.equal((await poll()).status, 200);

  // A notification poll every 10 minutes keeps the cookie fresh, but is not activity.
  for (let elapsed = 0; elapsed < SESSION_IDLE_MS - 10 * MINUTE; elapsed += 10 * MINUTE) {
    t.mock.timers.tick(10 * MINUTE);
    assert.equal((await poll()).status, 200);
  }
  t.mock.timers.tick(10 * MINUTE);
  assert.equal((await poll()).status, 401);
  // The old session is gone even for a real request.
  assert.equal((await fetch(`${base}/me`, { headers: { cookie } })).status, 401);
});

test("production refuses to start without a session secret", () => {
  assert.throws(() => sessionOptions({ store: null, env: { NODE_ENV: "production" } }), /SESSION_SECRET/);
  assert.equal(sessionOptions({ store: null, env: { SESSION_SECRET: "x" } }).cookie.maxAge, 2 * 60 * MINUTE);
});
