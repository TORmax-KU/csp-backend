const test = require("node:test");
const assert = require("node:assert/strict");
const { runMatching, trackedState, budgetFit, createSweeper } = require("../src/services/MatchingEngine");

const query = rows => ({ select: () => ({ lean: async () => rows.map(row => ({ ...row })) }) });

// Minimal stand-ins for the Mongoose models, covering only the calls runMatching makes.
// `open: true` marks a project as returned by the public feed query.
function fakeModels({ users, projects, skills }) {
  const matches = [];
  const notifications = [];
  let nextId = 1;
  const inIds = (filter, key, row) => !filter[key]?.$in || filter[key].$in.map(String).includes(String(row[key]));
  return {
    matches: matches, notifications: notifications,
    models: {
      users: { find: filter => query(users.filter(u => inIds(filter, "_id", u))) },
      projects: { find: filter => query(filter._id ? projects.filter(p => inIds(filter, "_id", p)) : projects.filter(p => p.open)) },
      skills: { find: () => query(skills) },
      notifications: { create: async doc => notifications.push(doc) },
      matches: {
        find: filter => query(matches.filter(m => inIds(filter, "userId", m))),
        deleteOne: async ({ _id }) => { matches.splice(matches.findIndex(m => m._id === _id), 1); },
        updateOne: async (filter, update, options = {}) => {
          const found = filter._id
            ? matches.find(m => m._id === filter._id && m.notifiedState === filter.notifiedState)
            : matches.find(m => m.userId === filter.userId && m.projectId === filter.projectId);
          if (found) { Object.assign(found, update.$set); return { modifiedCount: 1 }; }
          if (!options.upsert) return { modifiedCount: 0 };
          matches.push({ _id: `m${nextId++}`, ...filter, ...update.$setOnInsert, ...update.$set });
          return { upsertedCount: 1 };
        },
      },
    },
  };
}

const skills = [{ _id: "react", name: "React" }, { _id: "node", name: "Node.js" }, { _id: "java", name: "Java" }, { _id: "go", name: "Go" }];
const tor = (id, mandatorySkillNames, budget, extra = {}) => ({ _id: id, open: true, status: "Public", procurementStatus: "open",
  analysisStatus: "completed", budget, aiAnalysis: { mandatorySkillNames }, ...extra });

test("matches on skill threshold and budget, notifies once, and reports state changes", async () => {
  const vendor = { _id: "u1", proficiency: ["react", "node"], minBudget: 100000, maxBudget: 5000000 };
  const projects = [
    tor("full", ["React", "Node.js"], 1000000),
    tor("partial", ["React", "Java", "Go", "Node.js"], 1000000), // 50% < default 75
    tor("pricey", ["React", "Node.js"], 9000000),                 // above maxBudget
    tor("unmapped", ["React", "Cobol"], 1000000),                 // unknown skill: not scorable
  ];
  const db = fakeModels({ users: [vendor], projects, skills });
  const run = () => runMatching({ models: db.models });

  assert.deepEqual(await run(), { newMatches: 1, removed: 0, statusChanges: 0 });
  assert.deepEqual(db.notifications, [{ userId: "u1", projectId: "full", type: "NewMatch", matchPercentage: 100 }]);
  assert.equal(db.matches[0].notifiedState, "open");

  assert.deepEqual(await run(), { newMatches: 0, removed: 0, statusChanges: 0 });

  // Losing a skill drops the match silently; regaining it is a new match.
  vendor.proficiency = ["react"];
  assert.deepEqual(await run(), { newMatches: 0, removed: 1, statusChanges: 0 });
  vendor.proficiency = ["react", "node"];
  assert.deepEqual(await run(), { newMatches: 1, removed: 0, statusChanges: 0 });

  // Transient "unknown" during re-verification is not a state change.
  Object.assign(projects[0], { open: false, procurementStatus: "unknown" });
  assert.deepEqual(await run(), { newMatches: 0, removed: 0, statusChanges: 0 });

  Object.assign(projects[0], { procurementStatus: "cancelled" });
  assert.deepEqual(await run(), { newMatches: 0, removed: 0, statusChanges: 1 });
  assert.deepEqual(db.notifications.at(-1), { userId: "u1", projectId: "full", type: "StatusChange", fromState: "open", toState: "cancelled" });
  assert.deepEqual(await run(), { newMatches: 0, removed: 0, statusChanges: 0 });
  assert.equal(db.notifications.length, 3);

  // A deleted TOR's match is cleaned up without notifying.
  projects.splice(0, 1);
  assert.deepEqual(await run(), { newMatches: 0, removed: 1, statusChanges: 0 });
  assert.equal(db.matches.length, 0);
});

test("respects each vendor's own threshold and scopes profile-triggered runs", async () => {
  const strict = { _id: "strict", proficiency: ["react", "node", "java"], matchThreshold: 95 };
  const relaxed = { _id: "relaxed", proficiency: ["react", "node", "java"], matchThreshold: 50 };
  const projects = [tor("t1", ["React", "Node.js", "Java", "Go"], 1000000)]; // 75%
  const db = fakeModels({ users: [strict, relaxed], projects, skills });

  assert.deepEqual(await runMatching({ userIds: ["strict"], models: db.models }), { newMatches: 0, removed: 0, statusChanges: 0 });
  assert.deepEqual(await runMatching({ userIds: ["relaxed"], models: db.models }), { newMatches: 1, removed: 0, statusChanges: 0 });
  assert.deepEqual(db.notifications.map(n => [n.userId, n.matchPercentage]), [["relaxed", 75]]);
});

test("trackedState reports drafts and hides transient unknown", () => {
  assert.equal(trackedState({ status: "Draft", procurementStatus: "open" }), "draft");
  assert.equal(trackedState({ status: "Public", procurementStatus: "unknown" }), null);
  assert.equal(trackedState({ status: "Public", procurementStatus: "awarded" }), "awarded");
});


test("budgetFit places a TOR budget against the vendor's declared range", () => {
  const range = { minBudget: 100000, maxBudget: 5000000 };
  assert.equal(budgetFit({ budget: 50000 }, range), "below");
  assert.equal(budgetFit({ budget: 9000000 }, range), "above");
  assert.equal(budgetFit({ budget: 100000 }, range), "within");
  assert.equal(budgetFit({ budget: 9000000 }, {}), "within");
  assert.equal(budgetFit({}, range), "unknown");
});

const quietLog = { log() {}, error() {} };
const tick = () => new Promise(resolve => setImmediate(resolve));

test("requestMatching is a no-op until the scheduler starts, and is disabled by MATCHING_ENABLED=false", async () => {
  let runs = 0;
  const sweeper = createSweeper({ run: async () => { runs += 1; return {}; }, log: quietLog });
  assert.equal(sweeper.requestMatching(0), false);
  sweeper.startMatchingScheduler({ MATCHING_ENABLED: "false" });
  assert.equal(sweeper.requestMatching(0), false);
  await tick();
  assert.equal(runs, 0);
});

test("requests are debounced into one sweep, and a request during a sweep queues one follow-up", async () => {
  let runs = 0;
  let release;
  const sweeper = createSweeper({ run: () => { runs += 1; return new Promise(resolve => { release = () => resolve({}); }); }, log: quietLog });
  const timer = sweeper.startMatchingScheduler({});
  clearInterval(timer);
  assert.equal(runs, 1); // startup sweep, still running

  // While the startup sweep runs, a burst of requests collapses into one pending timer...
  assert.equal(sweeper.requestMatching(0), true);
  assert.equal(sweeper.requestMatching(0), false);
  await new Promise(resolve => setTimeout(resolve, 5));
  // ...whose sweep finds one already running, so it is queued rather than run concurrently.
  assert.equal(runs, 1);

  release();
  await tick();
  assert.equal(runs, 2); // the queued follow-up
  release();
  await tick();
  assert.equal(runs, 2);
});
