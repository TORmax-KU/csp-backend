const test = require("node:test");
const assert = require("node:assert/strict");
const tero = require("../src/services/TeroProcurementClient");
const govspending = require("../src/services/GovSpendingClient");
const { validateMetadata } = require("../src/services/TorMetadata");
const { processNext } = require("../src/services/TorAnalysisWorker");
const { metadata, result } = require("./fixtures/tor-v3");

const teroRow = patch => ({ source: "gprocurement", project_id: "69119366690", project_name: "ประกวดราคาซื้อครุภัณฑ์คอมพิวเตอร์",
  budget: "3519500.00", central_price: "3396066.67", announce_date: "2026-11-22T17:00:00.000000Z", ...patch });
const citation = quote => ({ quote, page: 1, documentIndex: 1 });

test("Tero listings keep their published ราคากลาง and ignore an empty one", () => {
  assert.equal(tero.toRecord(teroRow()).referencePrice, 3396066.67);
  for (const central_price of [null, "", "0.00", "n/a", undefined]) assert.equal(tero.toRecord(teroRow({ central_price })).referencePrice, undefined);
  assert.equal(tero.positiveAmount("1,250,000.50"), 1250000.5);
});

test("govspending price_build is recorded as the ราคากลาง", () => {
  const row = { project_id: "69089495963", project_name: "ซื้อสิทธิ์การใช้งานซอฟต์แวร์", project_money: 653021, price_build: 588478.6 };
  assert.equal(govspending.toRecord(row).referencePrice, 588478.6);
  assert.equal(govspending.toRecord({ ...row, price_build: 0 }).referencePrice, undefined);
});

test("a new listing stores its ราคากลาง; an existing project is not changed by later listings", async t => {
  const Project = require("../src/models/Project");
  const Log = require("../src/models/IngestionLog");
  const { ingestRecords } = require("../src/services/IngestionPipeline");
  t.mock.method(Log, "create", async value => value);
  let created;
  t.mock.method(Project, "findOne", () => ({ select: async () => null }));
  t.mock.method(Project, "create", async value => { created = value; });
  await ingestRecords({ source: tero.SOURCE, records: [tero.toRecord(teroRow())] });
  assert.equal(created.referencePrice, 3396066.67);

  let patch;
  t.mock.method(Project, "findOne", () => ({ select: async () => ({ _id: "existing", source: tero.SOURCE, sourceUrl: created.sourceUrl, rawData: {} }) }));
  t.mock.method(Project, "findByIdAndUpdate", async (_id, update) => { patch = update.$set; });
  await ingestRecords({ source: tero.SOURCE, records: [tero.toRecord(teroRow())] });
  assert.equal("referencePrice" in patch, false);
});

test("a TOR ราคากลาง is extracted with its own label and never blocks completion", () => {
  const value = metadata();
  value.referencePrice = { status: "found", reason: "", amountTHB: 3396066.67, evidence: citation("ราคากลาง\nจำนวนเงิน 3,396,066.67 บาท (สามล้านสามแสนเก้าหมื่นหกพันหกสิบหกบาทหกสิบเจ็ดสตางค์)") };
  assert.equal(validateMetadata(value, 1).values.referencePrice, 3396066.67);

  // A budget quote cannot stand in for a ราคากลาง, and the failure does not mark the TOR for review.
  value.referencePrice = { status: "found", reason: "", amountTHB: 3519500, evidence: citation("วงเงินงบประมาณ 3,519,500 บาท") };
  const checked = validateMetadata(value, 1);
  assert.equal(checked.values.referencePrice, null);
  assert.equal(checked.fields.referencePrice.status, "ambiguous");
  assert.equal(checked.needsReview, false);

  value.referencePrice = { status: "found", reason: "", amountTHB: 999, evidence: citation("ราคากลาง 3,396,066.67 บาท") };
  assert.equal(validateMetadata(value, 1).values.referencePrice, null);

  // Responses without the optional field still validate.
  const legacy = validateMetadata(metadata(), 1);
  assert.equal(legacy.values.referencePrice, null);
  assert.equal(legacy.fields.referencePrice.status, "not_found");
});

const analysed = referencePrice => ({ ...result(), metadata: { values: { budget: null, referencePrice, announcedAt: null, deadline: null, deadlinePrecision: "unknown" },
  fields: { budget: { status: "not_found" }, referencePrice: { status: referencePrice ? "found" : "not_found" }, announcedAt: { status: "not_found" }, deadline: { status: "not_found" } }, needsReview: false } });

async function runWorker(project, referencePrice) {
  const writes = [];
  await processNext({
    projects: { findOneAndUpdate: async () => ({ _id: "p1", sourceUrl: "https://egp2.bangkok.go.th/tor.pdf", ...project }), updateOne: async (_f, update) => writes.push(update) },
    skills: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    load: async () => [{ url: "https://egp2.bangkok.go.th/tor.pdf", bytes: Buffer.from("%PDF-") }],
    analyze: async () => analysed(referencePrice), onCompleted: () => {},
  });
  return writes[0].$set;
}

test("the worker fills ราคากลาง from the TOR only when the listing had none", async () => {
  assert.equal((await runWorker({}, 3396066.67)).referencePrice, 3396066.67);
  assert.equal("referencePrice" in await runWorker({ referencePrice: 3000000 }, 3396066.67), false);
  assert.equal("referencePrice" in await runWorker({}, null), false);
});
