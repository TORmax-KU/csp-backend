const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { archiveEntry, readEntry } = require("../src/services/TeroDocumentArchive");
const { archivedPdf, contentDisposition, clearCache } = require("../src/services/SourceDocument");

const fixture = fs.readFileSync(path.join(__dirname, "../postman/mocks/national-procurement/documents.zip"));
const ARCHIVE = "https://run-procurement.terodigital.com/announcements/gprocurement/69119366690/document";

test("only Tero archive entry URLs are recognised", () => {
  assert.deepEqual(archiveEntry(`${ARCHIVE}#file=Attach_TOR_1.pdf`), { archiveUrl: ARCHIVE, fileName: "Attach_TOR_1.pdf" });
  assert.equal(archiveEntry(`${ARCHIVE}#file=${encodeURIComponent("ขอบเขตงาน.pdf")}`).fileName, "ขอบเขตงาน.pdf");
  for (const url of [ARCHIVE, `${ARCHIVE}#file=readme.txt`, `http://run-procurement.terodigital.com/announcements/gprocurement/69119366690/document#file=a.pdf`,
    `https://evil.example/announcements/gprocurement/69119366690/document#file=a.pdf`, `${ARCHIVE}/../x#file=a.pdf`,
    `${ARCHIVE}#file=%E0%A4%A`, "https://egp2.bangkok.go.th/tor.pdf", "not a url"]) {
    assert.equal(archiveEntry(url), null, url);
  }
});

test("one named PDF is read from the ZIP, not the archive", async () => {
  const pdf = await readEntry(fixture, "Attach_TOR_1.pdf");
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  await assert.rejects(readEntry(fixture, "missing.pdf"), { code: "NO_TOR_DOCUMENT" });
  await assert.rejects(readEntry(Buffer.from("<html>not ZIP</html>"), "Attach_TOR_1.pdf"), { code: "UNSUPPORTED_DOCUMENT" });
});

test("archived PDFs are downloaded once from the allowed host and then cached", async () => {
  clearCache();
  const requested = [];
  const fetchImpl = async url => { requested.push(String(url)); return new Response(fixture, { status: 200 }); };
  const first = await archivedPdf(`${ARCHIVE}#file=Attach_TOR_1.pdf`, { fetchImpl });
  assert.equal(first.fileName, "Attach_TOR_1.pdf");
  assert.equal(first.bytes.subarray(0, 5).toString(), "%PDF-");
  await archivedPdf(`${ARCHIVE}#file=Attach_TOR_1.pdf`, { fetchImpl });
  assert.deepEqual(requested, [ARCHIVE]);
  assert.equal(await archivedPdf("https://egp2.bangkok.go.th/tor.pdf", { fetchImpl }), null);
});

test("PDF responses use an inline, header-safe filename", () => {
  assert.equal(contentDisposition("Attach_TOR_1.pdf"), `inline; filename="Attach_TOR_1.pdf"; filename*=UTF-8''Attach_TOR_1.pdf`);
  const thai = contentDisposition(`ขอบเขต "งาน" (1)'.pdf`);
  assert.match(thai, /^inline; filename="[\x20-\x7e]+"; filename\*=UTF-8''[A-Za-z0-9%._~!-]+$/);
  assert.doesNotMatch(thai.split("filename*=UTF-8''")[1], /['()"]/);
});

test("the document route returns the PDF and 404s for unknown documents", async t => {
  const Project = require("../src/models/Project");
  const { fetchDocument } = require("../controllers/ProjectController");
  clearCache();
  t.mock.method(globalThis, "fetch", async () => new Response(fixture, { status: 200 }));
  t.mock.method(Project, "findById", () => ({ select: () => ({ lean: async () => ({ status: "Public", documents: [
    { url: `${ARCHIVE}#file=Attach_TOR_1.pdf` }, { url: "https://egp2.bangkok.go.th/tor.pdf" },
  ] }) }) }));
  const call = async params => {
    const res = { headers: {}, statusCode: 0, body: null,
      set(h, v) { typeof h === "string" ? (this.headers[h] = v) : Object.assign(this.headers, h); return this; },
      status(code) { this.statusCode = code; return this; }, json(b) { this.body = b; return this; }, end(b) { this.body = b; return this; } };
    await fetchDocument({ params }, res);
    return res;
  };
  const ok = await call({ id: "6b04957e452a1f32979185dc", index: "0" });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers["Content-Type"], "application/pdf");
  assert.match(ok.headers["Content-Disposition"], /^inline; filename="Attach_TOR_1.pdf"/);
  assert.equal(ok.body.subarray(0, 5).toString(), "%PDF-");
  for (const params of [{ id: "6b04957e452a1f32979185dc", index: "1" }, { id: "6b04957e452a1f32979185dc", index: "9" },
    { id: "6b04957e452a1f32979185dc", index: "-1" }, { id: "bad", index: "0" }]) {
    assert.equal((await call(params)).statusCode, 404, JSON.stringify(params));
  }
});
