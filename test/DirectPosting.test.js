const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePosting, directPostingDefaults } = require("../src/services/DirectPosting");
const { availability } = require("../src/services/ProcurementAvailability");
const { calculateMatch } = require("../src/services/SkillMatching");
const { trackedState, scoreProject } = require("../src/services/MatchingEngine");
const { ProjectSchema } = require("../schemas/ProjectModel");
const mongoose = require("mongoose");

const now = new Date("2026-11-11T10:00:00+07:00");
const valid = {
  title: "Booking system for clinic",
  description: "Build a web booking system with admin dashboard and SMS reminders.",
  category: "information-system",
  skillNames: ["React", " node.js ", "React"],
  budgetMin: "200000",
  budget: 500000,
  deadline: "2026-12-01T17:00:00+07:00",
  contact: { name: "Somchai", email: "Somchai@Example.com" },
};

test("a complete posting validates and normalizes its fields", () => {
  const { value, skillNames, errors } = validatePosting(valid, { now });
  assert.deepEqual(errors, {});
  assert.deepEqual(skillNames, ["React", "node.js"]);
  assert.equal(value.budgetMin, 200000);
  assert.equal(value.contact.email, "somchai@example.com");
  assert.equal(value.deadline.toISOString(), "2026-12-01T10:00:00.000Z");
  assert.equal(value.sourceUrl, "");
});

test("UC4 E1: missing required fields are reported per field", () => {
  const { errors } = validatePosting({}, { now });
  for (const field of ["title", "description", "category", "skillNames", "budget", "deadline", "contact.name", "contact.email"]) {
    assert.ok(errors[field], `expected an error for ${field}`);
  }
});

test("rejects bad ranges, past deadlines, unsafe links and unreachable contacts", () => {
  const check = (patch) => validatePosting({ ...valid, ...patch }, { now }).errors;
  assert.ok(check({ budgetMin: 900000 }).budgetMin);
  assert.ok(check({ budget: -5 }).budget);
  assert.ok(check({ deadline: "2026-11-01T00:00:00Z" }).deadline);
  assert.ok(check({ deadline: "2030-01-01T00:00:00Z" }).deadline);
  assert.ok(check({ sourceUrl: "javascript:alert(1)" }).sourceUrl);
  assert.ok(check({ sourceUrl: "http://example.com" }).sourceUrl);
  assert.ok(check({ contact: { name: "A" } })["contact.email"]);
  assert.ok(check({ contact: { name: "A", phone: "abc" } })["contact.phone"]);
  assert.ok(check({ category: "hardware" }).category);
  assert.deepEqual(check({ contact: { name: "A", phone: "+66 81-234-5678" } }), {});
});

test("updates merge over the stored posting; an old deadline only blocks reopening", () => {
  const stored = { ...validatePosting(valid, { now }).value, procurementStatus: "open" };
  const later = new Date("2026-12-05T00:00:00Z");
  const rename = validatePosting({ title: "Booking system v2" }, { existing: stored, now: later });
  assert.deepEqual(rename.errors, {});
  assert.equal(rename.value.title, "Booking system v2");
  assert.equal(rename.value.budget, 500000);
  assert.equal(rename.skillNames, null);
  assert.ok(validatePosting({ procurementStatus: "open" }, { existing: stored, now: later }).errors.deadline);
  assert.equal(validatePosting({ procurementStatus: "closed" }, { existing: stored, now: later }).value.procurementStatus, "closed");
  assert.ok(validatePosting({ procurementStatus: "awarded" }, { existing: stored, now }).errors.procurementStatus);
  assert.ok(validatePosting({ budgetMin: 600000 }, { existing: stored, now }).errors.budgetMin);
});

test("postings skip the paid AI queue and fit the project schema", () => {
  const Model = mongoose.models.DirectPostingTest || mongoose.model("DirectPostingTest", ProjectSchema);
  const doc = new Model({ ...validatePosting(valid, { now }).value, externalId: "TMX-1", ...directPostingDefaults({ publisherId: new mongoose.Types.ObjectId(), now }) });
  assert.equal(doc.validateSync(), undefined);
  assert.equal(doc.analysisStatus, "skipped");
  assert.equal(doc.analysisAutoEligible, false);
  assert.equal(doc.source, "direct");
});

test("direct postings are open until their deadline without source verification", () => {
  const posting = { source: "direct", procurementStatus: "open", deadline: "2026-11-11T10:00:01+07:00", dataVerified: false };
  assert.equal(availability(posting, now), "open");
  assert.equal(availability({ ...posting, deadline: now }, now), "closed");
  assert.equal(availability({ ...posting, procurementStatus: "closed" }, now), "closed");
  assert.equal(availability({ ...posting, deadline: null }, now), "unknown");
});

test("direct postings are scorable from declared skills and report closing at the deadline", () => {
  const posting = { source: "direct", analysisStatus: "skipped", status: "Public", procurementStatus: "open",
    budget: 500000, requiredSkills: ["react", "node"], deadline: "2026-11-12T00:00:00+07:00" };
  assert.equal(calculateMatch(posting, ["react", "node"]).matchPercentage, 100);
  assert.equal(calculateMatch({ ...posting, source: "bangkok-egp" }, ["react", "node"]).matchPercentage, null);
  assert.ok(scoreProject(posting, { proficiency: ["react", "node"] }, []));
  assert.equal(trackedState(posting, now), "open");
  assert.equal(trackedState(posting, new Date("2026-11-12T00:00:00+07:00")), "closed");
});
