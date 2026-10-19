const literalRegex = value => ({ $regex: value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" });

const { publicProjectQuery } = require("./ProcurementAvailability");

async function buildProjectQuery(params, findSkillIds, now = new Date()) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  for (const key of ["search", "agency", "status", "priceFlag", "minBudget", "maxBudget", "deadline", "deadlineYear", "deadlineFrom", "deadlineTo", "availability", "method", "sort", "page", "limit"]) {
    if (params[key] !== undefined && typeof params[key] !== "string") invalid(`Invalid ${key}`);
  }
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 10);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) {
    invalid("Page must be a positive integer and limit must be between 1 and 100");
  }
  if (params.availability && !["open", "unknown"].includes(params.availability)) invalid("Invalid availability");
  if (params.status && params.status !== "Public") invalid("Only public projects are searchable");
  if (params.sort && !["deadline", "newest", "budget"].includes(params.sort)) invalid("Invalid sort");
  const query = publicProjectQuery(now, params.availability);
  const search = (params.search || "").trim();
  if (search.length > 300) invalid("Search must be 300 characters or fewer");
  if (search) {
    const regex = literalRegex(search);
    query.$or = ["title", "description", "descriptions", "agency", "externalId", "sourceSkillNames", "aiAnalysis.mandatorySkillNames"]
      .map(field => ({ [field]: regex }));
    if (/^[a-f\d]{24}$/i.test(search)) query.$or.push({ _id: search });
    const skillIds = await findSkillIds(regex);
    if (skillIds.length) query.$or.push({ requiredSkills: { $in: skillIds } });
  }
  if (params.agency?.trim()) query.agency = literalRegex(params.agency.trim());
  if (params.method?.trim()) query.procurementMethod = literalRegex(params.method.trim());
  if (params.status) query.status = params.status;
  if (params.priceFlag) query.priceFlag = params.priceFlag;
  for (const [key, operator] of [["minBudget", "$gte"], ["maxBudget", "$lte"]]) {
    if (params[key] !== undefined && params[key] !== "") {
      const value = Number(params[key]);
      if (!Number.isFinite(value) || value < 0) invalid("Budget must be a non-negative number");
      query.budget = { ...query.budget, [operator]: value };
    }
  }
  if (query.budget?.$gte > query.budget?.$lte) invalid("Minimum budget cannot exceed maximum budget");
  const bounds = {};
  const dateValue = (value, end = false) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid("Dates must use YYYY-MM-DD");
    const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}+07:00`);
    if (Number.isNaN(date.getTime()) || new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) invalid("Invalid date");
    return date;
  };
  if (params.deadlineYear) {
    let year = Number(params.deadlineYear);
    if (year >= 2400) year -= 543;
    if (!Number.isInteger(year) || year < 2000 || year > 2200) invalid("Invalid deadline year");
    bounds.$gte = dateValue(`${year}-01-01`);
    bounds.$lte = dateValue(`${year}-12-31`, true);
  }
  if (params.deadlineFrom) {
    const from = dateValue(params.deadlineFrom);
    bounds.$gte = bounds.$gte && bounds.$gte > from ? bounds.$gte : from;
  }
  if (params.deadlineTo || params.deadline) {
    const to = dateValue(params.deadlineTo || params.deadline, true);
    bounds.$lte = bounds.$lte && bounds.$lte < to ? bounds.$lte : to;
  }
  if (bounds.$gte > bounds.$lte) invalid("Deadline range is reversed or outside the selected year");
  if (Object.keys(bounds).length) {
    if (params.availability === "unknown") invalid("Unknown deadlines cannot be filtered by date");
    query.deadline = { ...query.deadline, ...bounds };
  }
  return { query, page, limit };
}

module.exports = { buildProjectQuery };
