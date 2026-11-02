const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Notification = require("../src/models/Notification");
const notificationRoutes = require("../src/routes/notification");

const OWNER = "012345678901234567890123";
const OTHER = "112345678901234567890123";
const NOTE = "212345678901234567890123";

test("notifications can be marked unread and deleted only by their owner", async (t) => {
  const note = new Notification({ _id: NOTE, userId: OWNER, projectId: OTHER, type: "NewMatch", read: true });
  t.mock.method(note, "save", async () => note);
  t.mock.method(Notification, "findById", async (id) => (String(id) === NOTE ? note : null));
  const deleted = [];
  t.mock.method(Notification, "deleteOne", async (filter) => {
    const hit = filter._id === NOTE && String(filter.userId) === OWNER;
    if (hit) deleted.push(filter._id);
    return { deletedCount: hit ? 1 : 0 };
  });

  let identity = { _id: OTHER };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = identity;
    req.isAuthenticated = () => true;
    next();
  });
  app.use("/api/notifications", notificationRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/notifications`;
  const patch = (id, body) => fetch(`${base}/${id}/read`, {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  try {
    assert.equal((await patch(NOTE, { read: false })).status, 403);
    assert.equal((await fetch(`${base}/${NOTE}`, { method: "DELETE" })).status, 404);
    assert.equal((await fetch(`${base}/not-an-id`, { method: "DELETE" })).status, 404);

    identity = { _id: OWNER };
    assert.equal((await patch(NOTE, { read: "no" })).status, 400);
    assert.equal((await patch(NOTE, { read: false })).status, 200);
    assert.equal(note.read, false);
    assert.equal((await patch(NOTE, {})).status, 200);
    assert.equal(note.read, true);

    assert.equal((await fetch(`${base}/${NOTE}`, { method: "DELETE" })).status, 200);
    assert.deepEqual(deleted, [NOTE]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
