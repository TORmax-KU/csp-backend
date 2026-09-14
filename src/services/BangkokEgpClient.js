const DEFAULT_SEARCH_URL = "https://egp2.bangkok.go.th/project-search";
const SOURCE = "bangkok-egp";
const PROJECT_DETAIL_URL = "https://egp2.bangkok.go.th/project-detail";

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json, text/plain, */*",
        "user-agent": "TORmax-public-aggregator/1.0",
        ...(options.headers || {}),
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Bangkok EGP returned HTTP ${response.status}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const firstValue = (record, keys) => {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return undefined;
};

const normalizeRecord = (record) => {
  const externalId = firstValue(record, [
    "externalId", "projectId", "id", "uuid", "ประกาศเลขที่", "เลขที่โครงการ",
  ]);
  const title = firstValue(record, [
    "title", "projectName", "name", "projectTitle", "ชื่อโครงการ",
  ]);
  const agency = firstValue(record, [
    "agency", "masterOrgGroupName", "department", "organization", "หน่วยงาน", "ชื่อหน่วยงาน",
  ]);
  const description = firstValue(record, [
    "description", "scope", "detail", "รายละเอียด", "ขอบเขตงาน",
  ]);
  const budget = firstValue(record, [
    "budget", "projectBudget", "estimatedPrice", "วงเงินงบประมาณ", "ราคากลาง",
  ]);
  const deadline = firstValue(record, [
    "deadline", "closingDate", "submissionDeadline", "วันที่สิ้นสุด",
  ]);
  const status = firstValue(record, [
    "status", "projectStatus", "state", "สถานะ",
  ]);
  const sourceUrl = firstValue(record, ["sourceUrl", "url", "detailUrl"])
    || (externalId ? `${PROJECT_DETAIL_URL}/${externalId}` : undefined);

  return {
    externalId: externalId === undefined ? "" : String(externalId).trim(),
    title: title === undefined ? "" : String(title).trim(),
    agency,
    description,
    budget: typeof budget === "string"
      ? Number(budget.replace(/[^\d.]/g, "")) || undefined
      : budget,
    deadline,
    status,
    sourceUrl,
    rawText: JSON.stringify(record),
    rawData: record,
  };
};

const findRecordArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return null;

  for (const key of ["data", "results", "items", "projects", "content", "records"]){
    if (Array.isArray(payload[key])) return payload[key];
  }

  for (const value of Object.values(payload)) {
    const result = findRecordArray(value);
    if (result) return result;
  }

  return null;
};

const buildSearchUrl = ({ budgetYear, page = 1, limit = 100 }) => {
  const baseUrl = process.env.EGP_API_URL || DEFAULT_SEARCH_URL;
  const url = new URL(baseUrl);
  url.searchParams.set("externalUserId", "");
  url.searchParams.set("projectSearchText", "");
  url.searchParams.set("masterOrgGroupId", "");
  url.searchParams.set("masterOrgDepartmentId", "");
  url.searchParams.set("masterAnnounceTypeId", "");
  url.searchParams.set("masterMethodIdId", "");
  url.searchParams.set("masterTypeIdId", "");
  url.searchParams.set("masterGoodIdId", "");
  url.searchParams.set("masterBussinessTypeId", "");
  url.searchParams.set("masterProjectTypeId", "");
  url.searchParams.set("masterProjectCategoryId", "");
  url.searchParams.set("masterBudgetYearId", String(budgetYear));
  url.searchParams.set("startDate", "");
  url.searchParams.set("endDate", "");
  url.searchParams.set("pageNo", String(page));
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("sortBy", "publishDateDesc");
  url.searchParams.set("bidderName", "");
  url.searchParams.set("bidderTaxNumber", "");
  return url.toString();
};

const fetchProjects = async ({ budgetYear = 2569, page = 1, limit = 100 } = {}) => {
  const url = buildSearchUrl({ budgetYear, page, limit });
  const payload = await fetchJson(url);
  const records = findRecordArray(payload);

  if (!records) {
    throw new Error("Bangkok EGP response did not contain a project array; set EGP_API_URL to the portal JSON endpoint");
  }

  return {
    source: SOURCE,
    sourceUrl: url,
    records: records.map(normalizeRecord),
    rawPayload: payload,
  };
};

module.exports = {
  DEFAULT_SEARCH_URL,
  SOURCE,
  PROJECT_DETAIL_URL,
  buildSearchUrl,
  fetchProjects,
  findRecordArray,
  normalizeRecord,
};
