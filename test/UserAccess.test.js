const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const userRoutes = require("../src/routes/user");

test("user routes deny anonymous and cross-account reads before querying private data", async () => {
  let identity;
  const app = express();
  app.use((req, res, next) => {
    req.user = identity;
    req.isAuthenticated = () => Boolean(identity);
    next();
  });
  app.use("/api/users", userRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/users`;
  try {
    assert.equal((await fetch(base)).status, 401);
    assert.equal((await fetch(`${base}/012345678901234567890123`)).status, 401);
    identity = { _id: "012345678901234567890123", role: "User" };
    assert.equal((await fetch(base)).status, 403);
    assert.equal((await fetch(`${base}/112345678901234567890123`)).status, 403);
    identity = { _id: "invalid", role: "User" };
    assert.equal((await fetch(`${base}/invalid`)).status, 404);
    identity = { _id: "012345678901234567890123", role: "Admin" };
    assert.equal((await fetch(`${base}/invalid`)).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
