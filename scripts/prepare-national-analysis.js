require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const fs = require('node:fs');
const Project = require('../src/models/Project');
const { publicationDate } = require('../src/services/RecentProcurementWindow');
const { classifySoftware } = require('../src/services/SoftwareKeywordClassifier');
const { analysisSkipReason } = require('../src/services/AnalysisQueuePolicy');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const rows = await Project.find({ source: { $in: ['tero-procurement', 'govspending'] } }).lean();
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync(`tmp/national-analysis-before-${Date.now()}.json`, JSON.stringify(rows));
  let updated = 0, excluded = 0;
  for (const row of rows) {
    const rawDate = row.rawData?.tero?.announce_date || row.rawData?.govspending?.announce_date;
    const date = publicationDate(rawDate);
    const set = {};
    if (Number.isFinite(date.getTime())) set.listingAnnouncedAt = date;
    if (!classifySoftware({ title: row.title }).isSoftware) {
      Object.assign(set, { classification: 'non-software', analysisAutoEligible: false, analysisStatus: 'skipped', analysisSkipReason: 'Outside IT procurement scope' }); excluded++;
    } else {
      const reason = analysisSkipReason(row);
      if (reason && row.analysisStatus !== 'completed') { Object.assign(set, { analysisAutoEligible: false, analysisStatus: 'skipped', analysisSkipReason: reason }); excluded++; }
      else if (row.aiPromptVersion === 'tor-pdf-v3-budget-dates' && ['needs_review', 'failed'].includes(row.analysisStatus)
        && (row.analysisErrorCode === 'INVALID_AI_RESPONSE' || Object.values(row.aiAnalysis?.fieldResults || {}).some(f => /Verbatim quote/.test(f.reason)))) {
        Object.assign(set, { analysisStatus: 'pending', analysisAutoEligible: true, analysisHold: false });
      }
    }
    // Never revoke an active worker lease in this maintenance pass.
    if (row.analysisStatus === 'processing') delete set.analysisStatus;
    await Project.updateOne({ _id: row._id, analysisStatus: row.analysisStatus }, { $set: set }); updated++;
  }
  const indexes = await Project.collection.indexes();
  const national = indexes.find(i => i.name === 'nationalProjectId_1');
  if (national && !national.unique) {
    const duplicates = await Project.aggregate([{ $match: { nationalProjectId: { $type: 'string' } } }, { $group: { _id: '$nationalProjectId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]);
    if (duplicates.length) throw new Error('Duplicate national IDs require review before changing the index');
    await Project.collection.dropIndex(national.name);
    await Project.collection.createIndex({ nationalProjectId: 1 }, { unique: true, sparse: true });
  }
  console.log(JSON.stringify({ updated, excluded, backup: 'tmp/national-analysis-before-*.json' }));
  await mongoose.disconnect();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
