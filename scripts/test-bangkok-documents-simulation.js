const assert = require('node:assert/strict');
const { fetchProjectDetail, fetchAnnouncements, deriveProcurementStatus, toTorDocuments, verifyPdfUrl } = require('../src/services/BangkokEgpDetailClient');
const { loadTor } = require('../src/services/TorSource');

(async () => {
  const base = process.argv[2] || 'http://host.docker.internal:4910/bangkok';
  // Keep the production logical URL/validation and forward its transport to
  // the local simulation; no request reaches a real procurement or AI service.
  const fetchImpl = (url, options) => {
    const original = new URL(url);
    assert.equal(original.hostname, 'egp2.bangkok.go.th');
    return fetch(base + original.pathname + original.search, options);
  };
  const detail = await fetchProjectDetail('contracted', { fetchImpl });
  assert.equal(deriveProcurementStatus([], detail), 'awarded');
  const announcements = await fetchAnnouncements('winner', { fetchImpl });
  assert.equal(deriveProcurementStatus(announcements), 'awarded');
  assert.equal(toTorDocuments(announcements).length, 0);
  const docs = await loadTor('https://egp2.bangkok.go.th/project-detail/unlabelled-tor', [], { fetchImpl });
  assert.equal(docs.length, 1);
  assert.equal(docs[0].bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await verifyPdfUrl(docs[0].url, { fetchImpl }), true);
  await assert.rejects(fetchProjectDetail('api-error', { fetchImpl }), /HTTP 500/);
  console.log('PASS: contracted status, winner filename exclusion, unlabelled TOR resolution, PDF verification, and HTTP 500 propagation over simulation HTTP. No Vertex calls.');
})().catch(error => { console.error(error); process.exitCode = 1; });
