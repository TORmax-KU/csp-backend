const test = require('node:test');
const assert = require('node:assert/strict');
const { toRecord } = require('../src/services/GovSpendingClient');
const { ingestRecords } = require('../src/services/IngestionPipeline');
const Project = require('../src/models/Project');
const Log = require('../src/models/IngestionLog');
const { classifySoftware } = require('../src/services/SoftwareKeywordClassifier');
test('contract evidence from GovSpending enriches the same national ID without replacing verified AI fields', async t => {
  const row = toRecord({ project_id: '69109156238', project_name: 'Software e-bidding', announce_date: '26 ต.ค. 69', contract: [{ contract_date: '2026-10-27' }], request: { 'api-key': 'must-not-persist' }, purchase_method_name: 'e-bidding' });
  assert.ok(!JSON.stringify(row).includes('must-not-persist'));
  let query, update;
  t.mock.method(Project, 'findOne', value => { query = value; return { select: async () => ({ _id: 'same', source: 'tero-procurement', sourceUrl: row.sourceUrl, rawData: { tero: { project_id: row.externalId } } }) }; });
  t.mock.method(Project, 'findByIdAndUpdate', async (_id, patch) => { update = patch.$set; });
  t.mock.method(Log, 'create', async value => value);
  await ingestRecords({ source: 'govspending', records: [row] });
  assert.equal(query.$or[0].nationalProjectId, '69109156238');
  assert.equal(update.source, 'tero-procurement');
  assert.equal(update.procurementStatus, 'awarded');
  assert.ok(update.rawData.tero); assert.ok(update.rawData.govspending);
  for (const key of ['budget', 'announcedAt', 'deadline', 'descriptions', 'aiAnalysis']) assert.equal(update[key], undefined);
});
test('medical scanners and electrical distribution hardware do not become software opportunities', () => {
  assert.equal(classifySoftware({ title: 'ประกวดราคาเช่าเครื่องเอกซเรย์คอมพิวเตอร์' }).isSoftware, false);
  assert.equal(classifySoftware({ title: 'ลูกถ้วย ตามโครงการพัฒนาระบบส่งและจำหน่าย' }).isSoftware, false);
  assert.equal(classifySoftware({ title: 'พัฒนาระบบสารสนเทศบริหารระบบส่งไฟฟ้า' }).isSoftware, true);
});
