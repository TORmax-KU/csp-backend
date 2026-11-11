const test = require("node:test");
const assert = require("node:assert/strict");
const { categorize, computeBenchmarks, priceVerdict, runPriceAnalysis, createPriceScheduler, MIN_SAMPLE, WIDE_SCOPE_SKILLS } = require("../src/services/PriceAnalysis");

const gov = (title, budget, extra = {}) => ({ _id: `${title}-${budget}`, title, budget, source: "bangkok-egp", classification: "software", ...extra });
// Ten information-system TORs from 1M to ~3.5M THB: median about 1.9M.
const systems = Array.from({ length: 10 }, (_, i) => gov(`พัฒนาระบบสารสนเทศ ${i}`, 1000000 + i * 280000));

test("categorizes Thai and English titles, most specific category first", () => {
  assert.equal(categorize({ title: "จ้างพัฒนาระบบสารสนเทศเพื่อการบริหาร" }), "information-system");
  assert.equal(categorize({ title: "จ้างบำรุงรักษาระบบสารสนเทศ (MA) ประจำปี" }), "maintenance-license");
  assert.equal(categorize({ title: "Mobile application for citizen services" }), "mobile-app");
  assert.equal(categorize({ title: "เช่าใช้บริการคลาวด์และเซิร์ฟเวอร์" }), "infrastructure");
  assert.equal(categorize({ title: "ระบบภูมิสารสนเทศ GIS" }), "gis");
  // "ai" must match as a word, not inside "maintain" or "email".
  assert.equal(categorize({ title: "Email gateway" }), "other-it");
  // A publisher's chosen category is trusted for direct postings.
  assert.equal(categorize({ source: "direct", category: "security", title: "ระบบสารสนเทศ" }), "security");
});

test("benchmarks use log-scale quartiles from government TORs only", () => {
  const benchmarks = computeBenchmarks([...systems, gov("ระบบงาน", 0), { ...systems[0], source: "direct", budget: 999999999 }]);
  const info = benchmarks.get("information-system");
  assert.equal(info.sampleSize, 10);
  assert.ok(info.q1Budget < info.medianBudget && info.medianBudget < info.q3Budget);
  assert.equal(info.minBudget, 1000000);
  assert.equal(benchmarks.get("all-it").sampleSize, 10);
});

test("flags budgets outside the category fences and explains the comparison", () => {
  const benchmarks = computeBenchmarks(systems);
  const now = new Date("2026-11-11T00:00:00Z");
  assert.equal(priceVerdict(gov("ระบบสารสนเทศใหม่", 2000000), benchmarks, now).priceFlag, "Normal");
  const high = priceVerdict(gov("ระบบสารสนเทศใหม่", 50000000), benchmarks, now);
  assert.equal(high.priceFlag, "Overpriced");
  assert.equal(high.priceAnalysis.benchmarkCategory, "information-system");
  assert.equal(high.priceAnalysis.sampleSize, 10);
  assert.ok(high.priceAnalysis.ratio > 20);
  assert.equal(priceVerdict(gov("ระบบสารสนเทศใหม่", 50000), benchmarks, now).priceFlag, "Underpriced");
});

test("wide scope on a bottom-quartile budget is a scope mismatch; narrow scope is not", () => {
  const benchmarks = computeBenchmarks(systems);
  const skills = count => Array.from({ length: count }, (_, i) => `Skill ${i}`);
  const cheap = (count) => gov("ระบบสารสนเทศ", 1050000, { analysisStatus: "completed", aiAnalysis: { mandatorySkillNames: skills(count) } });
  assert.equal(priceVerdict(cheap(WIDE_SCOPE_SKILLS), benchmarks).priceFlag, "ScopeMismatch");
  assert.equal(priceVerdict(cheap(2), benchmarks).priceFlag, "Normal");
  const posting = { source: "direct", category: "information-system", title: "x", budget: 1050000, requiredSkills: skills(WIDE_SCOPE_SKILLS) };
  assert.equal(priceVerdict(posting, benchmarks).priceFlag, "ScopeMismatch");
});

test("small categories fall back to the all-IT benchmark; no data means no flag", () => {
  const benchmarks = computeBenchmarks([...systems, gov("ระบบภูมิสารสนเทศ GIS", 2000000)]);
  const gis = priceVerdict(gov("ระบบภูมิสารสนเทศ GIS", 2000000), benchmarks);
  assert.equal(gis.priceAnalysis.category, "gis");
  assert.equal(gis.priceAnalysis.benchmarkCategory, "all-it");
  const sparse = computeBenchmarks(systems.slice(0, MIN_SAMPLE - 1));
  assert.deepEqual(priceVerdict(gov("ระบบสารสนเทศ", 2000000), sparse), { priceFlag: "Normal", priceAnalysis: null });
  assert.deepEqual(priceVerdict(gov("ระบบสารสนเทศ", null), benchmarks), { priceFlag: "Normal", priceAnalysis: null });
});

test("a run upserts benchmarks and writes only changed flags", async () => {
  const outlier = gov("ระบบสารสนเทศ outlier", 90000000);
  const rows = [...systems, outlier];
  const written = { benchmarks: [], projects: [] };
  const models = {
    projects: { find: () => ({ select: () => ({ lean: async () => rows }) }), bulkWrite: async ops => written.projects.push(...ops) },
    benchmarks: { bulkWrite: async ops => written.benchmarks.push(...ops) },
  };
  const counts = await runPriceAnalysis({ models });
  assert.deepEqual(written.benchmarks.map(op => op.updateOne.filter.category).sort(), ["all-it", "information-system"]);
  assert.equal(counts.updated, rows.length);
  const flagged = written.projects.find(op => op.updateOne.filter._id === outlier._id);
  assert.equal(flagged.updateOne.update.$set.priceFlag, "Overpriced");

  // Second run with the stored results: nothing changes, nothing is written.
  for (const op of written.projects) Object.assign(rows.find(r => r._id === op.updateOne.filter._id), op.updateOne.update.$set);
  written.projects.length = 0;
  assert.equal((await runPriceAnalysis({ models })).updated, 0);
  assert.equal(written.projects.length, 0);
});

test("scheduler requests are no-ops until started and can be disabled", () => {
  const scheduler = createPriceScheduler({ run: async () => assert.fail("must not run"), log: { log() {}, error() {} } });
  assert.equal(scheduler.requestPriceAnalysis(), false);
  assert.equal(scheduler.startPriceAnalysisScheduler({ PRICE_ANALYSIS_ENABLED: "false" }), undefined);
  assert.equal(scheduler.requestPriceAnalysis(), false);
});
