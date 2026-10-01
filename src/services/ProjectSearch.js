const literalRegex = value => ({ $regex: value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" });

async function buildProjectQuery(params, findSkillIds) {
  const invalid = message => { throw Object.assign(new Error(message), { status: 400 }); };
  for (const key of ["search", "agency", "status", "priceFlag", "minBudget", "maxBudget", "deadline", "page", "limit"]) {
    if (params[key] !== undefined && typeof params[key] !== "string") invalid(`Invalid ${key}`);
  }
  const page = Number(params.page ?? 1);
  const limit = Number(params.limit ?? 10);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger((page - 1) * limit)) {
    invalid("Page must be a positive integer and limit must be between 1 and 100");
  }
  const query = {};
  const search = (params.search || "").trim();
  if (search.length > 300) invalid("Search must be 300 characters or fewer");
  if (search) {
    const regex = literalRegex(search);
    query.$or = ["title", "description", "descriptions", "agency", "externalId", "aiAnalysis.mandatorySkillNames"]
      .map(field => ({ [field]: regex }));
    if (/^[a-f\d]{24}$/i.test(search)) query.$or.push({ _id: search });
    const skillIds = await findSkillIds(regex);
    if (skillIds.length) query.$or.push({ requiredSkills: { $in: skillIds } });
  }
  if (params.agency?.trim()) query.agency = literalRegex(params.agency.trim());
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
  if (params.deadline) {
    const deadline = new Date(params.deadline);
    if (Number.isNaN(deadline.getTime())) invalid("Invalid deadline");
    query.deadline = { $lte: deadline };
  }
  return { query, page, limit };
}

module.exports = { buildProjectQuery };
