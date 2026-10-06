const test = require("node:test");
const assert = require("node:assert/strict");

const {
  deriveProcurementStatus,
  toTorDocuments,
  verifyPdfUrl,
} = require("../src/services/BangkokEgpDetailClient");
const { enrichBangkokProjects } = require("../src/services/BangkokEgpEnrichment");

const invitation = {
  type: "ประกาศเชิญชวน",
  publishDate: "2026-07-26T17:00:00Z",
  url: "https://egp2.bangkok.go.th/api/file/a/invite.pdf",
};

test("derives cancelled from the latest cancellation announcement", () => {
  const rows = [
    invitation,
    { type: "ยกเลิกประกาศเชิญชวน", publishDate: "2026-09-07T17:00:00Z", url: null },
  ];
  assert.equal(deriveProcurementStatus(rows), "cancelled");
});

test("derives awarded from a winner announcement and open from an invitation", () => {
  assert.equal(
    deriveProcurementStatus([
      invitation,
      { type: "ประกาศผลผู้เสนอราคา", publishDate: "2026-09-01T17:00:00Z", url: null },
    ]),
    "awarded"
  );
  assert.equal(deriveProcurementStatus([invitation]), "open");
  assert.equal(deriveProcurementStatus([]), "unknown");
});

test("tor documents exclude cancellation and winner announcements", () => {
  const docs = toTorDocuments([
    invitation,
    { type: "ยกเลิกประกาศเชิญชวน", publishDate: "2026-09-07T17:00:00Z", url: "https://egp2.bangkok.go.th/api/file/b/cancel.pdf" },
    { type: "ประกาศราคากลาง", publishDate: "2026-07-26T17:00:00Z", url: "https://egp2.bangkok.go.th/api/file/c/price.pdf" },
  ]);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].url, invitation.url);
  assert.equal(docs[0].kind, "tor");
});

test("verifyPdfUrl accepts PDF magic bytes and rejects other content", async () => {
  const stream = (bytes) => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });
  const pdf = await verifyPdfUrl("https://egp2.bangkok.go.th/api/file/a/doc.pdf", {
    fetchImpl: async () => ({ ok: true, body: stream(Buffer.from("%PDF-1.7 rest")) }),
  });
  const html = await verifyPdfUrl("https://egp2.bangkok.go.th/api/file/a/doc.pdf", {
    fetchImpl: async () => ({ ok: true, body: stream(Buffer.from("<html>challenge</html>")) }),
  });
  const missing = await verifyPdfUrl("https://egp2.bangkok.go.th/api/file/a/doc.pdf", {
    fetchImpl: async () => ({ ok: false, body: stream(Buffer.alloc(0)) }),
  });
  assert.equal(pdf, true);
  assert.equal(html, false);
  assert.equal(missing, false);
});

test("enrichment stores verified TOR documents and derived status", async () => {
  const writes = [];
  const chain = { sort: () => chain, limit: () => chain, select: async () => [{ _id: "p1", externalId: "ext-1" }] };
  const result = await enrichBangkokProjects({
    projects: {
      find: () => chain,
      updateOne: async (filter, update) => { writes.push({ filter, update }); },
    },
    logs: { create: async () => ({}) },
    detail: async () => ({ procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)", referencePrice: 840000, sourceStatus: "ระหว่างดำเนินการ" }),
    announcements: async () => [invitation],
    verify: async () => true,
  });

  assert.equal(result.scanned, 1);
  assert.equal(result.enriched, 1);
  const set = writes[0].update.$set;
  assert.equal(set.procurementStatus, "open");
  assert.equal(set.dataVerified, true);
  assert.equal(set.documents.length, 1);
  assert.equal(set.documents[0].kind, "tor");
  assert.ok(set.sourceVerifiedAt instanceof Date);
  assert.equal(set.procurementMethod, "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)");
});

test("enrichment keeps projects unverified when no TOR PDF opens", async () => {
  const writes = [];
  const chain = { sort: () => chain, limit: () => chain, select: async () => [{ _id: "p1", externalId: "ext-1" }] };
  const result = await enrichBangkokProjects({
    projects: {
      find: () => chain,
      updateOne: async (filter, update) => { writes.push(update); },
    },
    logs: { create: async () => ({}) },
    detail: async () => ({ sourceStatus: "ระหว่างดำเนินการ" }),
    announcements: async () => [invitation],
    verify: async () => false,
  });

  assert.equal(result.enriched, 1);
  assert.equal(writes[0].$set.dataVerified, false);
  assert.deepEqual(writes[0].$set.documents, []);
});

test("enrichment failure of one project does not stop the batch", async () => {
  const chain = { sort: () => chain, limit: () => chain, select: async () => [{ _id: "p1", externalId: "bad" }, { _id: "p2", externalId: "good" }] };
  const result = await enrichBangkokProjects({
    projects: { find: () => chain, updateOne: async () => {} },
    logs: { create: async () => ({}) },
    detail: async (id) => { if (id === "bad") throw new Error("HTTP 500"); return {}; },
    announcements: async () => [],
    verify: async () => true,
  });

  assert.equal(result.scanned, 2);
  assert.equal(result.enriched, 1);
  assert.equal(result.failed, 1);
});
