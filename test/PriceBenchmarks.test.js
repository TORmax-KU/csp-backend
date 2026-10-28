const test = require('node:test');
const assert = require('node:assert/strict');
const { priceCategory, evaluatePrices, runPriceBenchmarks, ALL_IT } = require('../src/services/PriceBenchmarks');

const project = (id, budget, title = 'จ้างพัฒนาระบบบริหารงานบุคคล') => ({ _id: id, title, budget });

test('price categories come from scope keywords, most specific first', () => {
  assert.equal(priceCategory({ title: 'จ้างพัฒนาเว็บไซต์และฐานข้อมูลกลาง' }), 'Website');
  assert.equal(priceCategory({ title: 'จ้างพัฒนาระบบ e-Service' }), 'Software Development');
  assert.equal(priceCategory({ title: 'ซื้อเครื่องคอมพิวเตอร์สำนักงาน 3 เครื่อง' }), 'Hardware');
  assert.equal(priceCategory({ title: 'Annual maintenance', description: 'database tuning' }), 'Information Systems & Data');
  assert.equal(priceCategory({ title: 'จ้างที่ปรึกษา' }), ALL_IT);
});

test('budgets far from the category median are flagged; the rest stay Normal', () => {
  const now = new Date('2026-10-29T00:00:00Z');
  const rows = [1, 2, 3, 4].map(i => project(`n${i}`, 1_000_000)).concat(project('over', 3_000_000), project('under', 300_000));
  const { benchmarks, updates } = evaluatePrices(rows, now);
  const byId = Object.fromEntries(updates.map(u => [u._id, u]));
  assert.equal(byId.over.priceFlag, 'Overpriced');
  assert.equal(byId.over.priceAnalysis.ratio, 3);
  assert.equal(byId.under.priceFlag, 'Underpriced');
  assert.equal(byId.n1.priceFlag, 'Normal');
  assert.equal(byId.n1.priceAnalysis.benchmarkCategory, 'Software Development');
  assert.equal(byId.n1.priceAnalysis.medianBudget, 1_000_000);
  assert.deepEqual(byId.n1.priceAnalysis.evaluatedAt, now);
  assert.ok(benchmarks.some(b => b.category === ALL_IT && b.sampleSize === 6));
});

test('small categories fall back to All IT; too little data gives no comparison', () => {
  const rows = [1, 2, 3, 4].map(i => project(`s${i}`, 1_000_000)).concat(project('hw', 5_000_000, 'ซื้อเครื่องคอมพิวเตอร์'));
  const hw = evaluatePrices(rows).updates.find(u => u._id === 'hw');
  assert.equal(hw.priceAnalysis.category, 'Hardware');
  assert.equal(hw.priceAnalysis.benchmarkCategory, ALL_IT);
  assert.equal(hw.priceFlag, 'Overpriced');
  const sparse = evaluatePrices([project('a', 10), project('b', 1_000_000), project('c', null)]);
  assert.equal(sparse.benchmarks.length, 0);
  assert.equal(sparse.updates.length, 2);
  assert.ok(sparse.updates.every(u => u.priceFlag === 'Normal' && u.priceAnalysis === null));
});

test('a run never overwrites an admin override and clears stale comparisons', async () => {
  const writes = {};
  const projects = {
    find: () => ({ select: () => ({ lean: async () => [1, 2, 3, 4, 5].map(i => project(`p${i}`, 1_000_000)) }) }),
    bulkWrite: async ops => { writes.projects = ops; },
    updateMany: async (filter, update) => { writes.reset = { filter, update }; },
  };
  const benchmarks = { bulkWrite: async ops => { writes.benchmarks = ops; }, deleteMany: async filter => { writes.deleted = filter; } };
  const summary = await runPriceBenchmarks({ projects, benchmarks });
  assert.equal(summary.evaluated, 5);
  assert.ok(writes.projects.every(op => op.updateOne.filter.priceFlagOverride.$ne === true));
  assert.equal(writes.reset.filter.priceFlagOverride.$ne, true);
  assert.deepEqual(writes.reset.filter._id.$nin, ['p1', 'p2', 'p3', 'p4', 'p5']);
  assert.ok(writes.benchmarks.every(op => op.updateOne.upsert));
  assert.ok(writes.deleted.category.$nin.includes(ALL_IT));
});
