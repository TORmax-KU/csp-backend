const test = require("node:test");
const assert = require("node:assert/strict");
const { validateMetadata } = require("../src/services/TorMetadata");
const { validateAnalysis } = require("../src/services/VertexTorAnalyzer");
const { metadata, result } = require("./fixtures/tor-v3");
const citation = quote => ({ quote, page: 1, documentIndex: 1 });
const date = (overrides = {}) => ({ status: "found", reason: "", day: 28, month: 10, year: 2569, calendar: "BE", time: "12:00", evidence: citation("กำหนดยื่นข้อเสนอวันที่ 28 ตุลาคม 2569 เวลา 09.00 - 12.00 น."), ...overrides });
test("BE years and Thai digits convert once; explicit closing time is Bangkok time", () => {
  const value = metadata(); value.deadline = date({ evidence: citation("กำหนดยื่นข้อเสนอ ๒๘ ตุลาคม ๒๕๖๙ เวลา ๐๙.๐๐ - ๑๒.๐๐ น.") });
  const parsed = validateMetadata(value, 1);
  assert.equal(parsed.values.deadline, "2026-10-28T12:00:00+07:00");
  assert.equal(parsed.values.deadlinePrecision, "datetime");
});
test("Gregorian years stay Gregorian and date-only deadlines get no fabricated time", () => {
  const value = metadata(); value.deadline = date({ year: 2026, calendar: "CE", time: null, evidence: citation("Bid submission deadline 28 October 2026") });
  assert.equal(validateMetadata(value, 1).values.deadline, "2026-10-28");
  assert.equal(validateMetadata(value, 1).values.deadlinePrecision, "date");
});
test("wrong year, impossible dates, unsupported time and wrong event labels are withheld", () => {
  for (const patch of [{ year: 2026 }, { day: 31, month: 2 }, { time: "23:59" }, { evidence: citation("สิ้นสุดการส่งมอบ 28 ตุลาคม 2569 12.00") }, { evidence: { ...citation("ยื่นข้อเสนอ 28 ตุลาคม 2569 12.00"), documentIndex: 2 } }]) {
    const value = metadata(); value.deadline = date(patch);
    const parsed = validateMetadata(value, 1);
    assert.equal(parsed.values.deadline, null);
    assert.equal(parsed.fields.deadline.status, "ambiguous");
  }
});
test("deadline before publication is withheld rather than silently corrected", () => {
  const value = metadata(); value.deadline = date();
  value.announcedAt = date({ day: 29, time: null, evidence: citation("ประกาศ ณ วันที่ 29 ตุลาคม 2569") });
  assert.equal(validateMetadata(value, 1).values.deadline, null);
});
test("reference price cannot substitute for budget and cited amounts must agree", () => {
  for (const quote of ["ราคากลาง 1000000 บาท", "วงเงินงบประมาณ 2000000 บาท"]) {
    const value = metadata(); value.budget = { status: "found", reason: "", amountTHB: 1000000, evidence: citation(quote) };
    assert.equal(validateMetadata(value, 1).values.budget, null);
  }
  const value = metadata(); value.budget = { status: "found", reason: "", amountTHB: 1500000.50, evidence: citation("วงเงินงบประมาณ 1,500,000.50 บาท") };
  assert.equal(validateMetadata(value, 1).values.budget, 1500000.50);
});
test("missing fields remain null with reasons; partial announcements cannot invent scope", () => {
  assert.equal(validateMetadata(metadata(), 1).values.budget, null);
  assert.throws(() => validateAnalysis({ ...result(), metadata: undefined }));
  const partial = { ...result(), hasTorContent: false, descriptions: "" };
  assert.equal(validateAnalysis(partial).hasTorContent, false);
  assert.throws(() => validateAnalysis({ ...partial, descriptions: "invented scope" }));
});

test("startup releases pending holds only after credentials pass preflight", async () => {
  const { prepareWorker } = require("../src/services/TorAnalysisWorker");
  let authenticated = false;
  const projects = { updateMany: async (filter, update) => {
    assert.equal(authenticated, true);
    assert.deepEqual(filter, { analysisAutoEligible: { $ne: false }, analysisHold: true, analysisStatus: "pending" });
    assert.equal(update.$set.analysisHold, false);
    return { modifiedCount: 570 };
  } };
  assert.equal((await prepareWorker({ projects, authenticate: async () => { authenticated = true; } })).modifiedCount, 570);
  await assert.rejects(prepareWorker({ projects: { updateMany: () => assert.fail("Must preserve holds without credentials") }, authenticate: async () => { throw new Error("missing credentials"); } }), error => error.pauseWorker === true);
});
