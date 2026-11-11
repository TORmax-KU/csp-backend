// Use Case 6 / NFR-08: per-source scraper success rate against the 95% target.
// Usage: node scripts/report-ingestion-health.js [days=7]
//   Docker: docker compose exec -T backend node scripts/report-ingestion-health.js 7
require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const { ingestionHealth, ALERT_AFTER } = require('../src/services/IngestionHealth');

const percent = rate => (rate === null ? '   n/a' : `${(rate * 100).toFixed(1).padStart(5)}%`);

(async () => {
  const days = Number(process.argv[2] || 7);
  if (!Number.isInteger(days) || days < 1) throw new Error('days must be a positive integer');
  await mongoose.connect(process.env.MONGO_URI);
  const health = await ingestionHealth({ days });
  console.log(`Ingestion health, last ${days} day(s) — target ${health.target * 100}% (NFR-08)\n`);
  console.log('source               runs  ok  failed  empty   rate  streak  last success');
  for (const s of health.sources) {
    const flag = s.alerting ? '  ALERT' : '';
    console.log(`${s.source.padEnd(20)} ${String(s.runs).padStart(4)} ${String(s.succeeded).padStart(3)} ${String(s.failed).padStart(7)} ${String(s.empty).padStart(6)} ${percent(s.successRate)} ${String(s.consecutiveProblems).padStart(7)}  ${s.lastSuccessAt ? new Date(s.lastSuccessAt).toISOString() : 'never'}${flag}`);
    if (s.lastError && s.consecutiveProblems) console.log(`${''.padEnd(21)}last error: ${s.lastError}`);
  }
  const { overall } = health;
  console.log(`\noverall              ${String(overall.runs).padStart(4)} ${String(overall.succeeded).padStart(3)}                ${percent(overall.successRate)}  ${overall.meetsTarget === null ? '' : overall.meetsTarget ? 'meets target' : 'BELOW TARGET'}`);
  console.log(`"empty" = zero listings from a source that had listings recently. ALERT = ${ALERT_AFTER}+ problem runs in a row.`);
  await mongoose.disconnect();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
