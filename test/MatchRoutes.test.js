const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const Match = require("../src/models/Match");
const Project = require("../src/models/Project");
const matchRoutes = require("../src/routes/match");

const VENDOR = "012345678901234567890123";
const [A, B, C, CLOSED] = ["a", "b", "c", "d"].map(c => c.repeat(24));

async function startApp(getIdentity) {
  const app = express();
  app.use((req, res, next) => {
    req.user = getIdentity();
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.use("/api/matches", matchRoutes);
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}/api/matches` };
}

// Chainable stand-ins for the Mongoose queries the controller makes.
const chain = rows => {
  const query = { select: () => query, populate: () => query, lean: async () => rows };
  return query;
};

test("rejects anonymous users and invalid paging before querying", async (t) => {
  t.mock.method(Match, "find", () => assert.fail("must not query"));
  let identity;
  const { server, base } = await startApp(() => identity);
  try {
    assert.equal((await fetch(base)).status, 401);
    identity = { _id: VENDOR, role: "Vendor", proficiency: [] };
    assert.equal((await fetch(`${base}?page=0`)).status, 400);
    assert.equal((await fetch(`${base}?limit=101`)).status, 400);
    assert.equal((await fetch(`${base}?limit=abc`)).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("lists only the caller's matches on open TORs, best match first, then soonest deadline", async (t) => {
  const deadline = days => new Date(Date.now() + days * 86400000);
  t.mock.method(Match, "find", (filter) => {
    assert.equal(filter.userId, VENDOR);
    return chain([
      { projectId: A, matchPercentage: 80, matchedSkillIds: ["s1"] },
      { projectId: B, matchPercentage: 100, matchedSkillIds: ["s1", "s2"] },
      { projectId: C, matchPercentage: 80, matchedSkillIds: ["s2"] },
      { projectId: CLOSED, matchPercentage: 100, matchedSkillIds: [] },
    ]);
  });
  t.mock.method(Project, "find", (filter) => {
    // Restricted to the caller's matched TORs and to the public open-feed rules.
    assert.deepEqual(filter._id.$in.sort(), [A, B, C, CLOSED].sort());
    assert.equal(filter.procurementStatus, "open");
    assert.equal(filter.analysisStatus, "completed");
    // The open-feed query filtered out CLOSED.
    return chain([
      { _id: A, title: "A", procurementStatus: "open", deadline: deadline(20) },
      { _id: B, title: "B", procurementStatus: "open", deadline: deadline(30) },
      { _id: C, title: "C", procurementStatus: "open", deadline: deadline(10) },
    ]);
  });

  const identity = { _id: VENDOR, role: "Vendor", proficiency: ["s1"], matchThreshold: 80, minBudget: 1000 };
  const { server, base } = await startApp(() => identity);
  try {
    const response = await fetch(base);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const body = await response.json();
    assert.deepEqual(body.projects.map(p => p.title), ["B", "C", "A"]);
    assert.deepEqual(body.projects[0].match, { percentage: 100, matchedSkillIds: ["s1", "s2"] });
    assert.equal(body.total, 3);
    assert.deepEqual(body.profile, { isVendor: true, hasSkills: true, matchThreshold: 80, minBudget: 1000, maxBudget: null });

    const second = await (await fetch(`${base}?page=2&limit=2`)).json();
    assert.deepEqual(second.projects.map(p => p.title), ["A"]);
    assert.equal(second.total, 3);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("an account without matches gets an empty list and profile hints, without a project query", async (t) => {
  t.mock.method(Match, "find", () => chain([]));
  t.mock.method(Project, "find", () => assert.fail("no matches, no project query"));
  const { server, base } = await startApp(() => ({ _id: VENDOR, role: "JobLister" }));
  try {
    const body = await (await fetch(base)).json();
    assert.deepEqual(body.projects, []);
    assert.equal(body.total, 0);
    assert.deepEqual(body.profile, { isVendor: false, hasSkills: false, matchThreshold: 75, minBudget: null, maxBudget: null });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("TOR match breakdown names matched and missing skills and agrees with the engine's rule", async (t) => {
  const Skill = require("../src/models/Skill");
  const { matchSkills } = require("../controllers/TorAnalysisController");
  const project = { _id: A, analysisStatus: "completed", budget: 9000000,
    aiAnalysis: { mandatorySkillNames: ["React", "Node.js", "Go", "Java"] } };
  t.mock.method(Project, "findById", () => ({ lean: async () => structuredClone(project) }));
  t.mock.method(Skill, "find", () => chain(["react", "node", "go", "java"].map((id, i) => ({ _id: id, name: project.aiAnalysis.mandatorySkillNames[i] }))));

  const call = async user => {
    let body;
    await matchSkills({ params: { id: A }, user }, { status() { return this; }, json(value) { body = value; } }, error => { throw error; });
    return body;
  };

  const body = await call({ proficiency: ["react", "node", "go"], matchThreshold: 75, maxBudget: 5000000 });
  assert.equal(body.matchPercentage, 75);
  assert.deepEqual(body.matchedSkills.map(s => s.name), ["React", "Node.js", "Go"]);
  assert.deepEqual(body.missingSkills.map(s => s.name), ["Java"]);
  assert.equal(body.matchThreshold, 75);
  // Enough skills, but the budget is above the vendor's range, so no match alert would be sent.
  assert.equal(body.budgetFit, "above");
  assert.equal(body.isMatch, false);

  const fits = await call({ proficiency: ["react", "node", "go"] });
  assert.equal(fits.budgetFit, "within");
  assert.equal(fits.isMatch, true);
});
