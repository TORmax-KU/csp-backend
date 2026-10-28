// Apply a local, evidence-reviewed source snapshot. Does not call Vertex.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const { checkedUrl } = require('../src/services/TorSource');

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Supply the reviewed snapshot path; add --apply after preview');
  const review = JSON.parse(fs.readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
  if (review.version !== 1 || !Array.isArray(review.entries)) throw new Error('Invalid review snapshot');
  const apply = process.argv.includes('--apply');
  await mongoose.connect(process.env.MONGO_URI);
  const operations = [];
  const backup = [];
  const queued = [];
  for (const entry of review.entries) {
    if (!mongoose.isValidObjectId(entry.id) || !['open', 'unknown', 'closed', 'awarded', 'cancelled', 'draft'].includes(entry.status)) throw new Error('Invalid reviewed project');
    const verifiedAt = new Date(entry.checkedAt);
    if (!Number.isFinite(verifiedAt.getTime()) || verifiedAt > new Date() || Date.now() - verifiedAt.getTime() > 24 * 3600000) throw new Error('Review snapshot is stale or invalid');
    const project = await Project.findOne({ _id: entry.id, source: 'bangkok-egp', sourceUrl: entry.sourceUrl }).lean();
    if (!project) throw new Error(`Project/source changed: ${entry.id}`);
    if (project.analysisStatus === 'processing') throw new Error(`Project is being analyzed: ${entry.id}`);
    const set = { sourceStatus: entry.sourceStatus, procurementStatus: entry.status, procurementMethod: entry.method, sourceVerifiedAt: verifiedAt };
    if (entry.queue && project.analysisStatus !== 'completed') {
      if (['closed', 'awarded', 'cancelled', 'draft'].includes(entry.status) || !entry.documents?.length || !/e-bidding/i.test(entry.method)) throw new Error('Cannot queue an ineligible reviewed project');
      if (!entry.reviewedDeadline || new Date(entry.reviewedDeadline) <= new Date()) throw new Error('Reviewed future deadline required');
      const documents = entry.documents.map(doc => ({ title: doc.title || 'Reviewed official TOR/invitation', url: checkedUrl(doc.url).href, kind: 'tor', verifiedAt: new Date(doc.verifiedAt) }));
      if (documents.some(doc => !Number.isFinite(doc.verifiedAt.getTime()) || Date.now() - doc.verifiedAt.getTime() > 24 * 3600000)) throw new Error('Document verification is stale');
      Object.assign(set, { documents, dataVerified: true, analysisStatus: 'pending', analysisAutoEligible: true, analysisHold: true,
        analysisSkipReason: '', analysisError: '', analysisErrorCode: '', analysisRetryCount: 0 });
      queued.push({ id: entry.id, rank: entry.rank, deadline: entry.reviewedDeadline });
    } else if (['closed', 'awarded', 'cancelled', 'draft'].includes(entry.status) && project.analysisStatus !== 'completed') {
      Object.assign(set, { analysisStatus: 'skipped', analysisAutoEligible: false, analysisSkipReason: entry.reason || `Official source is ${entry.status}` });
    }
    backup.push(project);
    operations.push({ updateOne: { filter: { _id: project._id, sourceUrl: entry.sourceUrl, analysisStatus: project.analysisStatus },
      update: { $set: set, ...(set.analysisStatus ? { $unset: { nextAnalysisAt: 1, analysisLease: 1, analysisLeaseUntil: 1 } } : {}) } } });
  }
  if (apply) {
    const backupPath = path.resolve('tmp/source-review-backup-' + Date.now() + '.snapshot');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify({ savedAt: new Date(), projects: backup }, null, 2), { flag: 'wx' });
    const result = await Project.bulkWrite(operations, { ordered: true });
    console.log(JSON.stringify({ backupPath, matched: result.matchedCount, modified: result.modifiedCount }));
    if (result.matchedCount !== operations.length) throw new Error('Some projects changed during application; inspect before restarting');
  }
  console.log(JSON.stringify({ applied: apply, sourceUpdates: operations.length, queuedOnHoldUntilWorkerRestart: queued }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
