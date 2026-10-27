const test = require("node:test");
const assert = require("node:assert/strict");
const { parseItems } = require("../src/services/IeatProcurementClient");

test("IEAT imports invitations with stable IDs and excludes plans and drafts", () => {
  const html = `<section class="nw-panel" data-key="plans"><li class="nw-item"><div class="nw-body"><a class="nw-title" href="https://process5.gprocurement.go.th/plan">Plan</a><div class="nw-meta">P69100012345</div></div><div class="nw-act"><a href="https://process5.gprocurement.go.th/plan">Open</a></div></li></section>
    <section class="nw-panel" data-key="invites"><li class="nw-item"><div class="nw-date">15 ต.ค. 2569</div><div class="nw-body"><a class="nw-title" href="https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=abc">Software bid</a><div class="nw-meta">เลขที่โครงการ e-GP: 69109027555</div></div><div class="nw-act"><a href="https://process5.gprocurement.go.th/egp-template-service/dwnt/view-pdf-file?templateId=abc">เปิดประกาศ</a></div></li></section>
    <section class="nw-panel" data-key="draft_invites"><li class="nw-item"><div class="nw-body"><a class="nw-title" href="https://process5.gprocurement.go.th/draft">Draft</a></div></li></section>`;
  const records = parseItems(html);
  assert.equal(records.length, 1);
  assert.equal(records[0].externalId, "69109027555");
  assert.equal(records[0].title, "Software bid");
  assert.equal(records[0].deadline, undefined);
  assert.equal(records[0].rawData.category, "invitation");
});
