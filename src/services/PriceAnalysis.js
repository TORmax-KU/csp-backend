// FR-09: compare each software TOR's budget with TORs in the same IT category and flag outliers.
//
// Budgets span several orders of magnitude (100k to 100M THB), so statistics are computed on
// log10(budget). A budget outside the Tukey fences (Q1 - 1.5·IQR, Q3 + 1.5·IQR) of its category
// is Underpriced/Overpriced. ScopeMismatch marks a wide scope (many mandatory skills) funded at
// a bottom-quartile budget for its category.

const Project = require("../models/Project");
const CategoryBenchmark = require("../models/CategoryBenchmark");
const { ALLOWED_SOURCES, DIRECT_SOURCE } = require("./ProcurementAvailability");

// Ordered most specific first; the first category whose pattern matches wins.
// Thai has no word boundaries, so Thai terms match as substrings; Latin terms match whole words.
const PRICE_CATEGORIES = [
  { key: "security", thai: ["ความมั่นคงปลอดภัย", "ไฟร์วอลล์", "ไซเบอร์"], latin: ["cyber ?security", "firewall", "soc", "siem", "penetration", "pentest"] },
  { key: "gis", thai: ["ภูมิสารสนเทศ", "แผนที่", "ดาวเทียม"], latin: ["gis", "geospatial", "remote sensing", "satellite"] },
  { key: "mobile-app", thai: ["แอปพลิเคชันบนมือถือ", "แอปพลิเคชันบนอุปกรณ์เคลื่อนที่", "โมบายแอป", "สมาร์ทโฟน"], latin: ["mobile app(lication)?s?", "ios", "android", "flutter"] },
  { key: "data-ai", thai: ["ปัญญาประดิษฐ์", "ข้อมูลขนาดใหญ่", "วิเคราะห์ข้อมูล", "แดชบอร์ด", "ธุรกิจอัจฉริยะ"], latin: ["ai", "artificial intelligence", "machine learning", "big data", "data analytics?", "dashboards?", "business intelligence", "bi"] },
  { key: "maintenance-license", thai: ["บำรุงรักษา", "ซ่อมบำรุง", "ลิขสิทธิ์", "สิทธิ์การใช้งาน", "ต่ออายุ"], latin: ["maintenance", "ma", "licen[cs]es?", "subscriptions?", "renewal"] },
  { key: "infrastructure", thai: ["เครือข่าย", "เซิร์ฟเวอร์", "คลาวด์", "ศูนย์ข้อมูล", "ระบบสำรองข้อมูล", "อินเทอร์เน็ต"], latin: ["network(ing)?", "servers?", "cloud", "data ?cent(er|re)", "storage", "hosting", "virtuali[sz]ation", "backup"] },
  { key: "information-system", thai: ["ระบบสารสนเทศ", "ระบบบริหาร", "ระบบงาน", "พัฒนาระบบ", "เว็บไซต์", "แพลตฟอร์ม", "ระบบ"], latin: ["information systems?", "web ?sites?", "web app(lication)?s?", "portal", "platform", "erp", "e-service", "software development"] },
].map(category => ({
  key: category.key,
  pattern: new RegExp(`${category.thai.join("|")}|\\b(?:${category.latin.join("|")})\\b`, "i"),
}));

const CATEGORY_KEYS = [...PRICE_CATEGORIES.map(c => c.key), "other-it"];
const ALL_CATEGORY = "all-it";

const MIN_SAMPLE = 8;                    // below this a category falls back to the all-IT benchmark
const FENCE = 1.5;                        // Tukey fence multiplier
const MIN_LOG_IQR = Math.log10(2);        // stops near-identical budgets from flagging tiny differences
const WIDE_SCOPE_SKILLS = 8;              // mandatory skills that make a scope "wide"

function categorize(project) {
  if (project.source === DIRECT_SOURCE && CATEGORY_KEYS.includes(project.category)) return project.category;
  // The title is the most reliable signal; long AI summaries mention many unrelated systems.
  const title = String(project.title || "");
  const skills = (project.aiAnalysis?.mandatorySkillNames || []).join(" ");
  for (const text of [title, skills, String(project.descriptions || "")]) {
    const found = PRICE_CATEGORIES.find(category => category.pattern.test(text));
    if (found) return found.key;
  }
  return "other-it";
}

function quantile(sorted, q) {
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function summarize(category, budgets) {
  const logs = budgets.map(Math.log10).sort((a, b) => a - b);
  const sorted = [...budgets].sort((a, b) => a - b);
  const round = value => Math.round(value);
  return {
    category,
    sampleSize: budgets.length,
    medianBudget: round(10 ** quantile(logs, 0.5)),
    q1Budget: round(10 ** quantile(logs, 0.25)),
    q3Budget: round(10 ** quantile(logs, 0.75)),
    avgBudget: round(budgets.reduce((sum, value) => sum + value, 0) / budgets.length),
    minBudget: sorted[0],
    maxBudget: sorted.at(-1),
  };
}

// Benchmarks come only from government TORs: direct postings are self-declared and are
// flagged against the benchmarks, never used to build them.
function computeBenchmarks(projects) {
  const groups = new Map();
  const all = [];
  for (const project of projects) {
    if (project.source === DIRECT_SOURCE || !(project.budget > 0)) continue;
    const key = categorize(project);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(project.budget);
    all.push(project.budget);
  }
  const benchmarks = new Map();
  for (const [key, budgets] of groups) benchmarks.set(key, summarize(key, budgets));
  if (all.length) benchmarks.set(ALL_CATEGORY, summarize(ALL_CATEGORY, all));
  return benchmarks;
}

function scopeSize(project) {
  if (project.source === DIRECT_SOURCE) return (project.requiredSkills || []).length;
  return project.analysisStatus === "completed" ? (project.aiAnalysis?.mandatorySkillNames || []).length : null;
}

// Returns { priceFlag, priceAnalysis }. priceAnalysis is null when there is nothing to compare against.
function priceVerdict(project, benchmarks, now = new Date()) {
  if (!(project.budget > 0)) return { priceFlag: "Normal", priceAnalysis: null };
  const category = categorize(project);
  const own = benchmarks.get(category);
  const benchmark = own?.sampleSize >= MIN_SAMPLE ? own : benchmarks.get(ALL_CATEGORY);
  if (!benchmark || benchmark.sampleSize < MIN_SAMPLE) return { priceFlag: "Normal", priceAnalysis: null };

  const value = Math.log10(project.budget);
  const q1 = Math.log10(benchmark.q1Budget);
  const q3 = Math.log10(benchmark.q3Budget);
  const iqr = Math.max(q3 - q1, MIN_LOG_IQR);
  const skills = scopeSize(project);

  let priceFlag = "Normal";
  if (value < q1 - FENCE * iqr) priceFlag = "Underpriced";
  else if (value > q3 + FENCE * iqr) priceFlag = "Overpriced";
  else if (skills !== null && skills >= WIDE_SCOPE_SKILLS && project.budget < benchmark.q1Budget) priceFlag = "ScopeMismatch";

  return {
    priceFlag,
    priceAnalysis: {
      category,
      benchmarkCategory: benchmark.category,
      ratio: Math.round(project.budget / benchmark.medianBudget * 100) / 100,
      medianBudget: benchmark.medianBudget,
      q1Budget: benchmark.q1Budget,
      q3Budget: benchmark.q3Budget,
      avgBudget: benchmark.avgBudget,
      sampleSize: benchmark.sampleSize,
      scopeSkills: skills,
      evaluatedAt: now,
    },
  };
}

// Skips writes when nothing but the timestamp would change.
const signature = ({ priceFlag, priceAnalysis: a }) => a
  ? [priceFlag, a.category, a.benchmarkCategory, a.ratio, a.medianBudget, a.q1Budget, a.q3Budget, a.sampleSize, a.scopeSkills].join("|")
  : `${priceFlag}|none`;

const PROJECT_FIELDS = "title descriptions category source budget requiredSkills analysisStatus aiAnalysis.mandatorySkillNames priceFlag priceAnalysis";

async function runPriceAnalysis({ models = { projects: Project, benchmarks: CategoryBenchmark }, now = new Date() } = {}) {
  const { projects, benchmarks: benchmarkModel } = models;
  const rows = await projects.find({ classification: "software", source: { $in: [...ALLOWED_SOURCES, DIRECT_SOURCE] } })
    .select(PROJECT_FIELDS).lean();
  const benchmarks = computeBenchmarks(rows);

  if (benchmarks.size) {
    await benchmarkModel.bulkWrite([...benchmarks.values()].map(benchmark => ({
      updateOne: { filter: { category: benchmark.category }, update: { $set: benchmark }, upsert: true },
    })));
  }

  const updates = [];
  for (const project of rows) {
    const verdict = priceVerdict(project, benchmarks, now);
    if (signature(verdict) === signature({ priceFlag: project.priceFlag || "Normal", priceAnalysis: project.priceAnalysis })) continue;
    updates.push({ updateOne: { filter: { _id: project._id }, update: { $set: verdict } } });
  }
  if (updates.length) await projects.bulkWrite(updates);
  return { benchmarks: benchmarks.size, evaluated: rows.length, updated: updates.length };
}

// Flags one project immediately (e.g. a new direct posting) using the stored benchmarks.
async function assessProject(project, { benchmarkModel = CategoryBenchmark, now = new Date() } = {}) {
  const stored = await benchmarkModel.find({}).lean();
  return priceVerdict(project, new Map(stored.map(benchmark => [benchmark.category, benchmark])), now);
}

const SWEEP_INTERVAL_MS = 30 * 60 * 1000;
const REQUEST_DEBOUNCE_MS = 60 * 1000;

function createPriceScheduler({ run = runPriceAnalysis, log = console } = {}) {
  let active = false;
  let running = false;
  let rerun = false;
  let pending = null;

  async function sweep() {
    if (running) { rerun = true; return; }
    running = true;
    try {
      const counts = await run();
      if (counts.updated) log.log(`Price analysis: ${counts.updated} of ${counts.evaluated} TOR flags updated (${counts.benchmarks} benchmarks)`);
    } catch (error) {
      log.error("Price analysis failed:", error.message);
    } finally {
      running = false;
      if (rerun) { rerun = false; void sweep(); }
    }
  }

  // Debounced so a batch of completed analyses triggers one recompute. No-op until started.
  function requestPriceAnalysis(delayMs = REQUEST_DEBOUNCE_MS) {
    if (!active || pending) return false;
    pending = setTimeout(() => { pending = null; void sweep(); }, delayMs);
    pending.unref?.();
    return true;
  }

  function startPriceAnalysisScheduler(env = process.env) {
    if (String(env.PRICE_ANALYSIS_ENABLED ?? "true").trim().toLowerCase() === "false") return;
    active = true;
    const timer = setInterval(sweep, SWEEP_INTERVAL_MS);
    timer.unref();
    void sweep();
    return timer;
  }

  return { sweep, requestPriceAnalysis, startPriceAnalysisScheduler };
}

const { requestPriceAnalysis, startPriceAnalysisScheduler } = createPriceScheduler({ run: (...args) => runPriceAnalysis(...args) });

module.exports = {
  CATEGORY_KEYS, ALL_CATEGORY, MIN_SAMPLE, WIDE_SCOPE_SKILLS,
  categorize, computeBenchmarks, priceVerdict, runPriceAnalysis, assessProject,
  createPriceScheduler, requestPriceAnalysis, startPriceAnalysisScheduler,
};
