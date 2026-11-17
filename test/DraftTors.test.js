const test = require("node:test");
const assert = require("node:assert/strict");
const { deriveProcurementStatus, latestDraftDate } = require("../src/services/BangkokEgpDetailClient");
const { enrichBangkokProjects } = require("../src/services/BangkokEgpEnrichment");
const { ingestRecords } = require("../src/services/IngestionPipeline");
const { buildProjectQuery, projectSort } = require("../src/services/ProjectSearch");
const { draftProjectQuery, availability } = require("../src/services/ProcurementAvailability");
const { analysisSkipReason } = require("../src/services/AnalysisQueuePolicy");
const { DRAFT_SKIP_REASON } = require("../src/services/DraftState");
const Project = require("../src/models/Project");
const Log = require("../src/models/IngestionLog");

// Announcement type names as the Bangkok e-GP portal returns them (seen on live projects).
const reference = { type: "ประกาศราคากลาง", publishDate: "2026-10-01T03:00:00Z" };
const draftTor = { type: "ร่างขอบเขตของงาน (TOR)", publishDate: "2026-10-02T03:00:00Z", url: "https://egp2.bangkok.go.th/api/file/d/tor.pdf" };
const draftBid = { type: "ร่างเอกสารประกวดราคา (e-Bidding) และร่างเอกสารซื้อหรือจ้างด้วยวิธีสอบราคา", publishDate: "2026-10-05T03:00:00Z" };
const invitation = { type: "ประกาศเชิญชวน", publishDate: "2026-10-20T03:00:00Z", url: "https://egp2.bangkok.go.th/api/file/i/invite.pdf" };
const winner = { type: "ประกาศรายชื่อผู้ชนะการเสนอราคา / ประกาศรายชื่อผู้ได้รับการคัดเลือก", publishDate: "2026-11-10T03:00:00Z" };

test("FR-05: Bangkok projects with only draft announcements are drafts, not open bids", () => {
  // Before this fix every one of these was derived as "open", because draft TOR names match TOR_PATTERN.
  assert.equal(deriveProcurementStatus([draftTor]), "draft");
  assert.equal(deriveProcurementStatus([reference, draftTor]), "draft");
  assert.equal(deriveProcurementStatus([reference, draftTor, draftBid]), "draft");
  assert.equal(deriveProcurementStatus([draftBid, reference, draftTor]), "draft");
  // A final invitation opens bidding; a winner or cancellation still overrides everything.
  assert.equal(deriveProcurementStatus([draftTor, reference, invitation]), "open");
  assert.equal(deriveProcurementStatus([reference, draftTor, invitation, winner]), "awarded");
  assert.equal(deriveProcurementStatus([draftTor, { type: "ยกเลิกประกาศ", publishDate: "2026-10-09" }]), "cancelled");
  assert.equal(deriveProcurementStatus([reference]), "unknown");
  assert.equal(latestDraftDate([reference, draftTor, draftBid]).toISOString(), "2026-10-05T03:00:00.000Z");
  assert.equal(latestDraftDate([reference, invitation]), null);
});

function enrich(project, announcements) {
  const writes = [];
  const chain = { sort: () => chain, limit: () => chain, select: async () => [project] };
  return enrichBangkokProjects({
    projects: { find: () => chain, updateOne: async (_filter, update) => { writes.push(update.$set); } },
    logs: { create: async () => ({}) },
    detail: async () => ({ procurementMethod: "ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)" }),
    announcements: async () => announcements, tors: async () => [], verify: async () => true,
  }).then(() => writes[0]);
}

test("enrichment records a draft with its publication date and leaves AI analysis off", async () => {
  const set = await enrich({ _id: "p1", externalId: "e1", procurementStatus: "unknown", analysisStatus: "pending" }, [reference, draftTor, draftBid]);
  assert.equal(set.procurementStatus, "draft");
  assert.equal(set.status, "Draft");
  assert.equal(set.draftPublishedAt.toISOString(), "2026-10-05T03:00:00.000Z");
  assert.equal(set.analysisAutoEligible, undefined, "drafts are not queued for Vertex");
  // The worker skips anything still pending while it is a draft.
  assert.ok(analysisSkipReason({ status: "Draft", procurementStatus: "draft" }));
});

test("when the official invitation appears, the TOR goes public and is queued for analysis again", async () => {
  const set = await enrich({ _id: "p1", externalId: "e1", procurementStatus: "draft", analysisStatus: "skipped", analysisAutoEligible: false }, [reference, draftTor, invitation]);
  assert.equal(set.procurementStatus, "open");
  assert.equal(set.status, "Public");
  assert.equal(set.analysisStatus, "pending");
  assert.equal(set.analysisAutoEligible, true);
  assert.equal(set.analysisSkipReason, "");

  // An open TOR that stays open is not re-analysed on every enrichment.
  const steady = await enrich({ _id: "p2", externalId: "e2", procurementStatus: "open", analysisStatus: "completed" }, [invitation]);
  assert.equal(steady.status, "Public");
  assert.equal(steady.analysisStatus, undefined);
  // A draft that is cancelled stays out of the AI queue.
  const cancelled = await enrich({ _id: "p3", externalId: "e3", procurementStatus: "draft", analysisStatus: "skipped" }, [draftTor, { type: "ยกเลิกประกาศ", publishDate: "2026-10-09" }]);
  assert.equal(cancelled.procurementStatus, "cancelled");
  assert.equal(cancelled.analysisStatus, undefined);
});

function mockIngestion(t, existing) {
  const calls = { update: null, create: null };
  t.mock.method(Project, "findOne", () => ({ select: async () => existing }));
  t.mock.method(Project, "findByIdAndUpdate", async (_id, patch) => { calls.update = patch.$set; });
  t.mock.method(Project, "create", async doc => { calls.create = doc; });
  t.mock.method(Log, "create", async value => value);
  return calls;
}

const listing = { externalId: "B-1", title: "จ้างพัฒนาระบบสารสนเทศ", agency: "สำนักงาน", sourceUrl: "https://egp2.bangkok.go.th/project-detail/B-1" };

test("the 5-minute Bangkok listing scrape never undoes a draft found by enrichment", async t => {
  const calls = mockIngestion(t, { _id: "x", source: "bangkok-egp", sourceUrl: listing.sourceUrl, procurementStatus: "draft" });
  await ingestRecords({ source: "bangkok-egp", records: [listing] });
  assert.equal(calls.update.status, undefined);
  assert.equal(calls.update.procurementStatus, undefined);
});

test("national listings: a new draft is stored as a draft, and leaving draft re-queues analysis", async t => {
  const draftRow = { ...listing, externalId: "N-1", sourceStatus: "ร่างประกาศ", rawData: { tero: { id: "N-1" } }, listingAnnouncedAt: undefined };
  const created = mockIngestion(t, null);
  await ingestRecords({ source: "tero-procurement", records: [draftRow] });
  assert.equal(created.create.status, "Draft");
  assert.equal(created.create.procurementStatus, "draft");
  assert.ok(created.create.draftPublishedAt instanceof Date);
  assert.equal(created.create.analysisStatus, "skipped");
  assert.equal(created.create.analysisSkipReason, DRAFT_SKIP_REASON);

  const left = mockIngestion(t, { _id: "x", source: "tero-procurement", sourceUrl: listing.sourceUrl, rawData: { tero: {} }, procurementStatus: "draft", draftPublishedAt: new Date() });
  await ingestRecords({ source: "tero-procurement", records: [{ ...draftRow, sourceStatus: "ประกาศเชิญชวน" }] });
  assert.equal(left.update.status, "Public");
  assert.equal(left.update.procurementStatus, "unknown");
  assert.equal(left.update.analysisStatus, "pending");
  assert.equal(left.update.analysisAutoEligible, true);
});

test("drafts are listed while the source still shows them and for at most 90 days", () => {
  const now = new Date("2026-11-18T05:00:00Z");
  const query = draftProjectQuery(now);
  assert.equal(query.status, "Draft");
  assert.equal(query.procurementStatus, "draft");
  assert.equal(query.classification, "software");
  const [seen, age] = query.$and;
  assert.equal(seen.$or[0].sourceVerifiedAt.$gte.toISOString(), "2026-11-16T05:00:00.000Z");
  assert.equal(age.$or[0].draftPublishedAt.$gte.toISOString(), "2026-08-20T05:00:00.000Z");
  assert.equal(availability({ procurementStatus: "draft", status: "Draft" }, now), "draft");
});

test("UC3: search can list drafts only, or drafts alongside open TORs, with a sensible order", async () => {
  const now = new Date("2026-11-18T05:00:00Z");
  const drafts = await buildProjectQuery({ status: "Draft", agency: "กรุงเทพ" }, async () => [], now);
  assert.equal(drafts.status, "Draft");
  assert.equal(drafts.query.$and[0].status, "Draft");
  assert.ok(drafts.query.agency, "filters still apply to drafts");

  const both = await buildProjectQuery({ status: "all" }, async () => [], now);
  assert.equal(both.query.$and[0].$or.length, 3, "open government TORs, direct postings and drafts");
  assert.ok(both.query.$and[0].$or.some(branch => branch.status === "Draft"));

  const open = await buildProjectQuery({}, async () => [], now);
  assert.equal(open.status, "Public");
  assert.ok(open.query.$and[0].$or.every(branch => branch.status === "Public"), "the default feed is unchanged");

  assert.deepEqual(projectSort(undefined, "Draft"), { draftPublishedAt: -1, createdAt: -1, _id: -1 });
  assert.deepEqual(projectSort(undefined, "all"), { status: -1, deadline: 1, draftPublishedAt: -1, _id: 1 });
  assert.deepEqual(projectSort(undefined, "Public"), { deadline: 1, _id: 1 });
  assert.deepEqual(projectSort("budget", "Draft"), { budget: -1, _id: -1 });
});
