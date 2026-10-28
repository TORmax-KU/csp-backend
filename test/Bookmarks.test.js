const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { randomUUID } = require("node:crypto");
const bookmarkRoutes = require("../src/routes/bookmark");

async function startApp(getIdentity) {
  const app = express();
  app.use((req, res, next) => {
    req.user = getIdentity();
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/bookmarks", bookmarkRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/api/bookmarks` };
}

test("bookmark routes reject anonymous users and malformed ids before querying data", async () => {
  let identity;
  const { server, base } = await startApp(() => identity);
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/012345678901234567890123`, { method: "PUT" })).status, 401);
    assert.equal((await fetch(`${base}/012345678901234567890123`, { method: "DELETE" })).status, 401);
    identity = { _id: "012345678901234567890123" };
    assert.equal((await fetch(`${base}/invalid`, { method: "PUT" })).status, 404);
    assert.equal((await fetch(`${base}/invalid`, { method: "DELETE" })).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("bookmarks are saved per user, newest first, and only for public projects", { skip: !process.env.TEST_MONGO_URI }, async () => {
  const dbName = `bookmarks_test_${randomUUID().replaceAll("-", "")}`;
  await mongoose.connect(process.env.TEST_MONGO_URI, { dbName });
  const User = require("../src/models/User");
  const Project = require("../src/models/Project");
  let identity;
  const { server, base } = await startApp(() => identity);
  try {
    const [owner, other] = await User.create([{ email: `owner-${dbName}@example.org` }, { email: `other-${dbName}@example.org` }]);
    const [first, second, draft] = await Project.create([
      { title: "First", status: "Public" },
      { title: "Second", status: "Public" },
      { title: "Draft", status: "Draft" },
    ]);
    const put = id => fetch(`${base}/${id}`, { method: "PUT" });
    const del = id => fetch(`${base}/${id}`, { method: "DELETE" });

    identity = { _id: owner._id };
    assert.deepEqual((await (await fetch(base)).json()).ids, []);
    assert.deepEqual((await (await put(first._id)).json()).ids, [String(first._id)]);
    assert.deepEqual((await (await put(second._id)).json()).ids, [String(second._id), String(first._id)]);
    // Saving twice does not duplicate.
    assert.deepEqual((await (await put(first._id)).json()).ids, [String(second._id), String(first._id)]);
    assert.equal((await put(draft._id)).status, 404);
    assert.equal((await put(new mongoose.Types.ObjectId())).status, 404);

    identity = { _id: other._id };
    assert.deepEqual((await (await fetch(base)).json()).ids, []);

    identity = { _id: owner._id };
    assert.deepEqual((await (await del(second._id)).json()).ids, [String(first._id)]);
    assert.deepEqual((await (await del(second._id)).json()).ids, [String(first._id)]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
