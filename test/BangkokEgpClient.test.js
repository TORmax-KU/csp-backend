const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildSearchUrl,
  findRecordArray,
  normalizeRecord,
} = require("../src/services/BangkokEgpClient");

test("buildSearchUrl targets the year-filtered JSON API with paging", () => {
  const url = new URL(buildSearchUrl({ budgetYear: 2569, page: 2, limit: 50 }));

  assert.equal(
    `${url.origin}${url.pathname}`,
    "https://egp2.bangkok.go.th/appapi/api/Projects/GetProjectFromFilter"
  );
  assert.equal(url.searchParams.get("masterBudgetYearId"), "2569");
  assert.equal(url.searchParams.get("pageNo"), "2");
  assert.equal(url.searchParams.get("pageSize"), "50");
  assert.equal(url.searchParams.get("sortBy"), "publishDateDesc");
});

test("normalizes the current Bangkok EGP project fields", () => {
  const raw = {
    projectId: "project-1",
    projectNumber: "69099316505",
    projectName: "จ้างบำรุงรักษาระบบและโปรแกรมประยุกต์",
    masterOrgGroupName: "สำนักดิจิทัลกรุงเทพมหานคร",
    masterContractAvailableName: "ระหว่างดำเนินการ",
    projectBudget: 7087000,
  };

  const project = normalizeRecord(raw);

  assert.equal(project.externalId, "project-1");
  assert.equal(project.title, raw.projectName);
  assert.equal(project.agency, raw.masterOrgGroupName);
  assert.equal(project.status, raw.masterContractAvailableName);
  assert.equal(project.budget, 7087000);
  assert.equal(project.sourceUrl, "https://egp2.bangkok.go.th/project-detail/project-1");
  assert.deepEqual(project.rawData, raw);
});

test("findRecordArray reads the API data array", () => {
  const records = [{ projectId: "one" }];
  assert.equal(findRecordArray({ totalCount: 1, data: records }), records);
});
