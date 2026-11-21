const test = require("node:test");
const assert = require("node:assert/strict");
const Skill = require("../src/models/Skill");
const { fetch, create, deleteSkill } = require("../controllers/SkillController");

const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });

test("fetch rejects a non-string search/category (NoSQL injection attempt)", async t => {
  const res1 = response();
  await fetch({ query: { search: { $where: "1" } } }, res1);
  assert.equal(res1.statusCode, 400);

  const res2 = response();
  await fetch({ query: { category: { $ne: null } } }, res2);
  assert.equal(res2.statusCode, 400);
});

test("fetch treats search/category as a literal string, not a regular expression", async t => {
  let usedQuery;
  t.mock.method(Skill, "find", (query) => { usedQuery = query; return { sort: async () => [{ name: "C++" }] }; });
  const res = response();
  await fetch({ query: { search: "C++" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(usedQuery.name.$regex, "C\\+\\+");
});

test("create is Admin-only and requires a name", async t => {
  const forbidden = response();
  await create({ user: { role: "Vendor" }, body: { name: "Go" } }, forbidden);
  assert.equal(forbidden.statusCode, 403);

  const missingName = response();
  await create({ user: { role: "Admin" }, body: {} }, missingName);
  assert.equal(missingName.statusCode, 400);

  t.mock.method(Skill, "create", async (doc) => ({ _id: "s1", ...doc }));
  const res = response();
  await create({ user: { role: "Admin" }, body: { name: "Go", category: "language" } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.name, "Go");
});

test("deleteSkill is Admin-only and 404s when the skill does not exist", async t => {
  const forbidden = response();
  await deleteSkill({ user: { role: "Vendor" }, params: { id: "s1" } }, forbidden);
  assert.equal(forbidden.statusCode, 403);

  t.mock.method(Skill, "findByIdAndDelete", async () => null);
  const notFound = response();
  await deleteSkill({ user: { role: "Admin" }, params: { id: "s1" } }, notFound);
  assert.equal(notFound.statusCode, 404);
});
