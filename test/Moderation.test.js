const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Project = require("../src/models/Project");
const User = require("../src/models/User");
const ModerationLog = require("../src/models/ModerationLog");
const PostReport = require("../src/models/PostReport");
const Notification = require("../src/models/Notification");
const { moderatePost, setUserStatus } = require("../controllers/AdminController");
const adminRoutes = require("../src/routes/admin");

const POST = "6ae0b63ffb773330336475e6";
const LISTER = "6ae0b63ffb773330336475e7";
const ADMIN = "6ae0b63ffb773330336475e8";
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
const lean = value => ({ select: () => ({ lean: async () => value }), lean: async () => value });

function mockStore(t, { project, publisher }) {
  const calls = [];
  t.mock.method(Project, "findById", () => lean(project));
  t.mock.method(User, "findById", () => lean(publisher));
  t.mock.method(User, "updateOne", async (filter, update) => { calls.push(["disable", filter, update]); return { modifiedCount: 1 }; });
  t.mock.method(Project, "updateMany", async (filter, update) => { calls.push(["closeOthers", filter, update]); return { modifiedCount: 2 }; });
  t.mock.method(ModerationLog, "findOneAndUpdate", async (filter, update, options) => { calls.push(["log", filter, update, options]); return {}; });
  t.mock.method(Project, "deleteOne", async filter => { calls.push(["delete", filter]); return { deletedCount: 1 }; });
  t.mock.method(PostReport, "updateMany", async (filter, update) => { calls.push(["reports", filter, update]); return { modifiedCount: 3 }; });
  t.mock.method(Notification, "updateMany", async (filter, update) => { calls.push(["notifications", filter, update]); return { modifiedCount: 1 }; });
  return calls;
}

const directPost = { _id: POST, title: "Build a booking site", source: "direct", publisherId: LISTER };

test("UC5: removing a posting disables the publisher first, then logs, then deletes — without a transaction", async t => {
  const calls = mockStore(t, { project: directPost, publisher: { _id: LISTER, email: "lister@example.com", role: "JobLister" } });
  const res = response();
  await moderatePost({ params: { id: POST }, user: { _id: ADMIN }, body: { reason: "  Scam: asks vendors for a deposit  " } }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { message: "Posting removed and publisher account disabled", accountDisabled: true, otherPostingsClosed: 2, reportsResolved: 3 });
  assert.deepEqual(calls.map(call => call[0]), ["disable", "closeOthers", "log", "delete", "reports", "notifications"]);

  const [, disableFilter, disableUpdate] = calls[0];
  assert.deepEqual(disableFilter, { _id: LISTER });
  assert.deepEqual(disableUpdate, { $set: { status: "Disabled" }, $inc: { sessionVersion: 1 } });

  const [, closeFilter, closeUpdate] = calls[1];
  assert.deepEqual(closeFilter, { _id: { $ne: POST }, source: "direct", publisherId: LISTER, procurementStatus: "open" });
  assert.deepEqual(closeUpdate, { $set: { procurementStatus: "closed" } });

  const [, logFilter, logUpdate, logOptions] = calls[2];
  assert.deepEqual(logFilter, { targetProjectId: POST });
  assert.equal(logOptions.upsert, true);
  assert.deepEqual(logUpdate.$setOnInsert, {
    adminId: ADMIN, targetProjectId: POST, targetUserId: LISTER, reason: "Scam: asks vendors for a deposit",
    projectTitle: "Build a booking site", publisherEmail: "lister@example.com", accountDisabled: true, otherPostingsClosed: 2,
  });

  assert.deepEqual(calls[3][1], { _id: POST });
  assert.deepEqual(calls[4][1], { projectId: POST, status: "open" });
  assert.equal(calls[4][2].$set.outcome, "removed");
  assert.deepEqual(calls[5][2], { $set: { deleted: true } });
});

test("removal needs a reason and a direct posting; government TORs are refused", async t => {
  const calls = mockStore(t, { project: { ...directPost, source: "bangkok-egp", publisherId: null }, publisher: null });
  const send = async (id, body) => { const res = response(); await moderatePost({ params: { id }, user: { _id: ADMIN }, body }, res); return res.statusCode; };
  assert.equal(await send("bad-id", { reason: "spam" }), 404);
  assert.equal(await send(POST, {}), 400);
  assert.equal(await send(POST, { reason: "   " }), 400);
  assert.equal(await send(POST, { reason: "x".repeat(501) }), 400);
  assert.equal(await send(POST, { reason: "spam" }), 400);
  assert.deepEqual(calls, [], "nothing may change when the request is refused");
});

test("removing a posting never disables an admin account", async t => {
  const calls = mockStore(t, { project: directPost, publisher: { _id: LISTER, email: "other-admin@example.com", role: "Admin" } });
  const res = response();
  await moderatePost({ params: { id: POST }, user: { _id: ADMIN }, body: { reason: "Test posting" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.accountDisabled, false);
  assert.deepEqual(calls.map(call => call[0]), ["log", "delete", "reports", "notifications"]);
});

test("a retry after a partial failure finishes the job instead of failing", async t => {
  const calls = mockStore(t, { project: directPost, publisher: { _id: LISTER, email: "lister@example.com", role: "JobLister" } });
  let failDelete = true;
  t.mock.method(Project, "deleteOne", async () => { if (failDelete) { failDelete = false; throw new Error("connection reset"); } calls.push(["delete"]); return { deletedCount: 1 }; });
  t.mock.method(console, "error", () => {});

  const first = response();
  await moderatePost({ params: { id: POST }, user: { _id: ADMIN }, body: { reason: "Fraud" } }, first);
  assert.equal(first.statusCode, 500);
  assert.equal(calls[0][0], "disable", "the account is disabled even though the delete failed");

  const retry = response();
  await moderatePost({ params: { id: POST }, user: { _id: ADMIN }, body: { reason: "Fraud" } }, retry);
  assert.equal(retry.statusCode, 200);
  assert.ok(calls.some(call => call[0] === "delete"));
  // The log is an upsert keyed by posting, so the retry cannot create a duplicate entry.
  assert.ok(calls.filter(call => call[0] === "log").every(call => call[3].upsert === true && call[2].$setOnInsert));
});

test("admins cannot change their own status or disable another admin", async t => {
  t.mock.method(User, "findById", async () => ({ role: "Admin" }));
  t.mock.method(User, "findByIdAndUpdate", () => assert.fail("must not update"));
  const send = async (id, status) => { const res = response(); await setUserStatus({ params: { id }, user: { _id: ADMIN }, body: { status } }, res); return res.statusCode; };
  assert.equal(await send(ADMIN, "Disabled"), 400);
  assert.equal(await send(LISTER, "Disabled"), 403);
  assert.equal(await send(LISTER, "Paused"), 400);
  assert.equal(await send("bad-id", "Active"), 404);
});

test("admin routes, including the new posting and report queues, refuse non-admins", async () => {
  let identity;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = identity; req.isAuthenticated = () => Boolean(identity); next(); });
  app.use("/api/admin", adminRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  try {
    for (const [method, path] of [["GET", "/posts"], ["DELETE", `/posts/${POST}`], ["GET", "/post-reports"], ["PATCH", `/post-reports/${POST}`]]) {
      identity = undefined;
      assert.equal((await fetch(base + path, { method })).status, 401, `${method} ${path} anonymous`);
      identity = { _id: LISTER, role: "JobLister" };
      assert.equal((await fetch(base + path, { method })).status, 403, `${method} ${path} non-admin`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
