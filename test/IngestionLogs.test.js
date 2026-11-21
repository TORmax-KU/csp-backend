const test = require("node:test");
const assert = require("node:assert/strict");
const IngestionLog = require("../src/models/IngestionLog");
const { fetchIngestionLogs } = require("../controllers/AdminController");

const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

function mockFind(t, rows) {
  t.mock.method(IngestionLog, "find", () => ({
    sort: () => ({ skip: () => ({ limit: async () => rows }) }),
  }));
  t.mock.method(IngestionLog, "countDocuments", async () => rows.length);
}

test("UC6: ingestion logs reject a status outside the IngestionLog enum", async t => {
  mockFind(t, []);
  const res = response();
  await fetchIngestionLogs({ query: { status: "foo" } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid status" });
});

test("UC6: ingestion logs reject a non-string status (NoSQL injection attempt)", async t => {
  mockFind(t, []);
  const res = response();
  await fetchIngestionLogs({ query: { status: { $ne: null } } }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Invalid status" });
});

test("UC6: ingestion logs list newest first and accept a valid status filter", async t => {
  const rows = [{ source: "gistda-procurement", status: "Success" }];
  mockFind(t, rows);
  const res = response();
  await fetchIngestionLogs({ query: { status: "Success" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { logs: rows, total: 1 });
});

test("UC6: ingestion logs with no status filter return everything", async t => {
  const rows = [{ source: "egat-bidding", status: "Failed" }];
  mockFind(t, rows);
  const res = response();
  await fetchIngestionLogs({ query: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { logs: rows, total: 1 });
});
