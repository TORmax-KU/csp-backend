const test = require("node:test");
const assert = require("node:assert/strict");
const { announcementLabel, announcementPriority } = require("../src/services/BangkokEgpDocumentMetadata");
const { deriveProcurementStatus, toTorDocuments, fetchAnnouncements } = require("../src/services/BangkokEgpDetailClient");
const { analysisSkipReason } = require("../src/services/AnalysisQueuePolicy");

test("missing announcement labels use filenames and winner files never become TOR candidates", async () => {
  const rows = [{ id: "winner", masterAnnounceTypeName: null, projectAnnouncementPath: "ประกาศผู้ชนะการเสนอราคาจ้างซ่อมคอมพิวเต_1793170110509.pdf" },
    { id: "tor", masterAnnounceTypeName: null, projectAnnouncementPath: "ขอบเขตของงาน_TOR.pdf" }];
  const announcements = await fetchAnnouncements("test", { fetchImpl: async () => new Response(JSON.stringify({ data: rows })) });
  assert.equal(deriveProcurementStatus(announcements), "awarded");
  assert.equal(toTorDocuments(announcements).length, 1);
  assert.match(toTorDocuments(announcements)[0].url, /tor\//);
  assert.match(announcementLabel({ masterAnnounceTypeName: "ประกาศเชิญชวน", projectAnnouncementPath: "ประกาศผู้ชนะ.pdf" }), /ผู้ชนะ/);
});

test("contracted detail status overrides an invitation and excludes work before AI", () => {
  const invitation = [{ type: "ประกาศเชิญชวน", publishDate: "2026-10-01" }];
  assert.equal(deriveProcurementStatus(invitation, { sourceStatusCode: "C01" }), "awarded");
  assert.equal(deriveProcurementStatus([], { sourceStatus: "จัดทำสัญญา/ PO แล้ว" }), "awarded");
  assert.equal(deriveProcurementStatus([], { sourceStatusCode: "C04", sourceStatus: "ส่งงานครบถ้วน" }), "closed");
  assert.equal(deriveProcurementStatus([], { sourceStatusCode: "S5" }), "cancelled");
  assert.equal(deriveProcurementStatus(invitation, { sourceStatusCode: "S1", sourceStatus: "ระหว่างดำเนินการ" }), "open");
  assert.ok(analysisSkipReason({ source: "bangkok-egp", procurementStatus: "unknown", sourceStatus: "จัดทำสัญญา/ PO แล้ว" }));
  assert.equal(announcementPriority("ร่างประกาศเชิญชวน"), 2);
});

test("enrichment retains contract status and cannot requeue the disabled backlog", async () => {
  const { enrichBangkokProjects } = require("../src/services/BangkokEgpEnrichment");
  let written;
  const chain = { sort: () => chain, limit: () => chain, select: async () => [{ _id: "old", externalId: "contracted", analysisStatus: "awaiting_documents", analysisAutoEligible: false, documents: [] }] };
  await enrichBangkokProjects({ projects: { find: () => chain, updateOne: async (_query, update) => { written = update.$set; } },
    logs: { create: async () => {} }, detail: async () => ({ sourceStatusCode: "C01", sourceStatus: "จัดทำสัญญา/ PO แล้ว" }),
    announcements: async () => [{ type: "ประกาศเชิญชวน", url: "https://egp2.bangkok.go.th/tor.pdf" }], tors: async () => [], verify: async () => true });
  assert.equal(written.procurementStatus, "awarded");
  assert.equal(written.analysisStatus, undefined);
});
