const { ingestRecords } = require('./IngestionPipeline');
const { loadTor } = require('./TorSource');
const Project = require('../models/Project');
const IngestionLog = require('../models/IngestionLog');
const { createHash } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Renew only after re-reading the underlying PDFs. A changed archive needs fresh AI.
async function refreshDocuments(source) {
  const before = new Date(Date.now() - 12 * 3600000);
  const rows = await Project.find({ source, procurementStatus: { $nin: ['closed', 'awarded', 'cancelled', 'draft'] }, $or: [
    { analysisStatus: 'completed', deadline: { $gt: new Date() }, sourceVerifiedAt: { $lt: before } },
    { analysisStatus: { $in: ['awaiting_documents', 'needs_review'] }, analysisAutoEligible: { $ne: false }, documentCheckedAt: { $lt: before } },
  ] }).sort({ documentCheckedAt: 1 }).limit(10).lean();
  for (const row of rows) {
    try {
      const documents = await loadTor(row.sourceUrl);
      const unchanged = row.documents.length === documents.length && documents.every(d => row.documents.some(old => old.url === d.url && old.sha256 === hash(d.bytes)));
      await Project.updateOne({ _id: row._id, analysisStatus: row.analysisStatus }, { $set: unchanged
        ? { sourceVerifiedAt: new Date(), documentCheckedAt: new Date(), 'documents.$[].verifiedAt': new Date() }
        : { dataVerified: false, documentCheckedAt: new Date(), analysisStatus: 'pending', analysisAutoEligible: true, analysisHold: false } });
    } catch {
      await Project.updateOne({ _id: row._id }, { $set: { documentCheckedAt: new Date() } });
      // Stale evidence expires out of the feed; keep completed AI for review.
    }
  }
}
async function run(client, opts) {
  const startedAt = new Date();
  let data;
  try {
    data = await client.fetchListings({ onProgress: page => console.log(`${page.source} scan: fiscal year ${page.year}, offset ${page.offset}, ${page.count} rows`), ...opts });
  } catch (error) {
    // Recorded like the other sources so failures count against the success rate (NFR-08).
    await IngestionLog.create({ source: client.SOURCE, sourceUrl: client.ENDPOINT || client.ORIGIN || '', status: 'Failed',
      errorMessage: `${error.code || 'SOURCE_UNAVAILABLE'}: ${error.message}`, startedAt, finishedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime() }).catch(e => console.error(`Cannot save ${client.SOURCE} ingestion log:`, e.message));
    throw error;
  }
  const log = await ingestRecords(data);
  await refreshDocuments(data.source);
  console.log(`${data.source}: ${log.projectsCreated} created, ${log.projectsUpdated} updated, ${log.projectsFiltered} filtered`);
  return log;
}
module.exports = {
  runTeroIngestion: opts => run(require('./TeroProcurementClient'), opts),
  runGovSpendingIngestion: opts => run(require('./GovSpendingClient'), opts),
};
