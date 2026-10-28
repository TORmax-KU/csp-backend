const cron = require("node-cron");
const Project = require("../models/Project");
const CategoryBenchmark = require("../models/CategoryBenchmark");
const { normalizeText } = require("./SoftwareKeywordClassifier");

// Every TOR is stored as "Software", so benchmarks group by the scope keywords
// instead. Most specific first: a website build that mentions a database is web work.
const PRICE_CATEGORIES = [
  ["Cybersecurity", ["cyber", "ไซเบอร์"]],
  ["Website", ["website", "เว็บไซต์"]],
  ["Software Development", ["software", "application", "web application", "mobile application", "system development", "ซอฟต์แวร์", "โปรแกรม", "แอปพลิเคชัน", "พัฒนาระบบ"]],
  ["Network & Cloud", ["network maintenance", "ระบบเครือข่าย", "cloud", "ระบบคลาวด์"]],
  ["Information Systems & Data", ["information technology", "database", "ระบบสารสนเทศ", "เทคโนโลยีสารสนเทศ", "ฐานข้อมูล"]],
  ["Hardware", ["hardware", "computer", "server", "network equipment", "คอมพิวเตอร์", "ฮาร์ดแวร์", "เซิร์ฟเวอร์", "แม่ข่าย"]],
];
const ALL_IT = "All IT";
const MIN_SAMPLE = 5;
// Compared with the median: a few very large contracts would drag an average far off.
const OVERPRICED_RATIO = 2.5;
const UNDERPRICED_RATIO = 0.4;

function priceCategory(project) {
  const text = normalizeText([project.title, project.description, project.descriptions].filter(Boolean).join(" "));
  return PRICE_CATEGORIES.find(([, keywords]) => keywords.some(keyword => text.includes(normalizeText(keyword))))?.[0] || ALL_IT;
}

function budgetStats(budgets) {
  const sorted = [...budgets].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    sampleSize: sorted.length,
    avgBudget: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    medianBudget: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    minBudget: sorted[0],
    maxBudget: sorted.at(-1),
  };
}

// Pure so the thresholds can be tested without a database.
function evaluatePrices(projects, now = new Date()) {
  const budgeted = projects.filter(p => Number.isFinite(p.budget) && p.budget > 0).map(p => ({ ...p, priceCategory: priceCategory(p) }));
  const groups = new Map([[ALL_IT, budgeted.map(p => p.budget)]]);
  for (const project of budgeted) {
    if (project.priceCategory === ALL_IT) continue;
    groups.set(project.priceCategory, [...(groups.get(project.priceCategory) || []), project.budget]);
  }
  const benchmarks = new Map([...groups].filter(([, budgets]) => budgets.length >= MIN_SAMPLE).map(([category, budgets]) => [category, budgetStats(budgets)]));
  const updates = budgeted.map(project => {
    const benchmarkCategory = benchmarks.has(project.priceCategory) ? project.priceCategory : benchmarks.has(ALL_IT) ? ALL_IT : null;
    if (!benchmarkCategory) return { _id: project._id, priceFlag: "Normal", priceAnalysis: null };
    const benchmark = benchmarks.get(benchmarkCategory);
    const ratio = Math.round(project.budget / benchmark.medianBudget * 100) / 100;
    return {
      _id: project._id,
      priceFlag: ratio > OVERPRICED_RATIO ? "Overpriced" : ratio < UNDERPRICED_RATIO ? "Underpriced" : "Normal",
      priceAnalysis: { category: project.priceCategory, benchmarkCategory, ratio, medianBudget: benchmark.medianBudget,
        avgBudget: benchmark.avgBudget, sampleSize: benchmark.sampleSize, evaluatedAt: now },
    };
  });
  return { benchmarks: [...benchmarks].map(([category, stats]) => ({ category, ...stats })), updates };
}

async function runPriceBenchmarks({ projects = Project, benchmarks = CategoryBenchmark, now = new Date() } = {}) {
  const rows = await projects.find({ classification: "software", budget: { $gt: 0 } })
    .select("_id title description descriptions budget").lean();
  const result = evaluatePrices(rows, now);
  if (result.benchmarks.length) {
    await benchmarks.bulkWrite(result.benchmarks.map(({ category, ...stats }) => ({
      updateOne: { filter: { category }, update: { $set: stats }, upsert: true },
    })));
  }
  await benchmarks.deleteMany({ category: { $nin: result.benchmarks.map(b => b.category) } });
  // An admin-set flag is a reviewed decision; recalculation must not undo it.
  if (result.updates.length) {
    await projects.bulkWrite(result.updates.map(({ _id, ...set }) => ({
      updateOne: { filter: { _id, priceFlagOverride: { $ne: true } }, update: { $set: set } },
    })));
  }
  // Projects that lost their budget keep no stale comparison.
  await projects.updateMany({ _id: { $nin: result.updates.map(u => u._id) }, priceAnalysis: { $ne: null }, priceFlagOverride: { $ne: true } },
    { $set: { priceFlag: "Normal", priceAnalysis: null } });
  const counts = result.updates.reduce((all, u) => ({ ...all, [u.priceFlag]: (all[u.priceFlag] || 0) + 1 }), {});
  return { benchmarks: result.benchmarks.length, evaluated: result.updates.length, ...counts };
}

let started = false;
function startPriceBenchmarkScheduler({ env = process.env, logger = console } = {}) {
  if (started || env.PRICE_BENCHMARKS_ENABLED === "false") return;
  started = true;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { logger.log("Price benchmarks:", JSON.stringify(await runPriceBenchmarks())); }
    catch (error) { logger.error("Price benchmark run failed:", error.message); }
    finally { running = false; }
  };
  // Budgets only change when TOR analysis completes, so hourly is enough.
  cron.schedule("0 * * * *", run, { timezone: "Asia/Bangkok" });
  void run();
}

module.exports = { priceCategory, evaluatePrices, runPriceBenchmarks, startPriceBenchmarkScheduler, MIN_SAMPLE, OVERPRICED_RATIO, UNDERPRICED_RATIO, ALL_IT };
