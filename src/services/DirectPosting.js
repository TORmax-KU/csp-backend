// FR-13 / Use Case 4: validation and storage shape for job postings published directly on TORmax.
const { DIRECT_SOURCE } = require("./ProcurementAvailability");
const { CATEGORY_KEYS } = require("./PriceAnalysis");
const { parseSkillNames } = require("./SkillCatalog");

const MAX_POSTING_SKILLS = 30;
const MAX_DEADLINE_MS = 2 * 365 * 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^[0-9+\-() ]{6,30}$/;

const text = value => (typeof value === "string" ? value.trim() : value);

function httpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function money(value) {
  if (value === null || value === "" || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : NaN;
}

// Validates a complete posting. On update, pass the stored posting as `existing`: submitted fields are
// merged over it, so cross-field rules (budget range, contact channel) always see the final values.
// Returns { value, skillNames, errors } where errors maps field paths to messages.
function validatePosting(input, { existing = null, now = new Date() } = {}) {
  const body = input && typeof input === "object" ? input : {};
  const pick = (key, fallback) => (body[key] !== undefined ? body[key] : fallback);
  const errors = {};
  const value = {};

  value.title = text(pick("title", existing?.title));
  if (typeof value.title !== "string" || value.title.length < 5) errors.title = "Title must be at least 5 characters";
  else if (value.title.length > 200) errors.title = "Title must be 200 characters or fewer";

  value.description = text(pick("description", existing?.description));
  if (typeof value.description !== "string" || value.description.length < 20) errors.description = "Describe the scope in at least 20 characters";
  else if (value.description.length > 10000) errors.description = "Scope must be 10,000 characters or fewer";

  const agency = text(pick("agency", existing?.agency ?? ""));
  if (typeof agency !== "string" || agency.length > 200) errors.agency = "Organization must be 200 characters or fewer";
  else value.agency = agency;

  value.category = pick("category", existing?.category);
  if (!CATEGORY_KEYS.includes(value.category)) errors.category = "Choose a project category";

  let skillNames = null;
  if (body.skillNames !== undefined || !existing) {
    const parsed = parseSkillNames(body.skillNames ?? [], { max: MAX_POSTING_SKILLS, owner: "A posting" });
    if (parsed.error) errors.skillNames = parsed.error;
    else if (!parsed.names.length) errors.skillNames = "Add at least one required skill";
    else skillNames = parsed.names;
  }

  const budget = money(pick("budget", existing?.budget));
  const budgetMin = money(pick("budgetMin", existing?.budgetMin ?? null));
  if (budget === null || Number.isNaN(budget) || budget <= 0) errors.budget = "Enter a maximum budget greater than 0";
  else if (budget > 1e10) errors.budget = "Budget is too large";
  else value.budget = budget;
  if (Number.isNaN(budgetMin) || (budgetMin !== null && budgetMin < 0)) errors.budgetMin = "Minimum budget must be 0 or more";
  else if (budgetMin !== null && value.budget !== undefined && budgetMin > value.budget) errors.budgetMin = "Minimum budget cannot exceed the maximum";
  else value.budgetMin = budgetMin;

  const rawDeadline = pick("deadline", existing?.deadline);
  const deadline = rawDeadline ? new Date(rawDeadline) : null;
  // An unchanged deadline on a closed posting may be in the past; a new or reopened one may not.
  const requireFuture = !existing || body.deadline !== undefined || body.procurementStatus === "open";
  if (!deadline || Number.isNaN(deadline.getTime())) errors.deadline = "Enter an application deadline";
  else if (requireFuture && deadline <= now) errors.deadline = "Deadline must be in the future";
  else if (deadline.getTime() > now.getTime() + MAX_DEADLINE_MS) errors.deadline = "Deadline must be within 2 years";
  else value.deadline = deadline;

  const contactInput = body.contact !== undefined ? body.contact : existing?.contact;
  const contact = contactInput && typeof contactInput === "object" ? contactInput : {};
  value.contact = { name: text(contact.name) || "", email: (text(contact.email) || "").toLowerCase(), phone: text(contact.phone) || "" };
  if (!value.contact.name) errors["contact.name"] = "Enter a contact name";
  else if (value.contact.name.length > 100) errors["contact.name"] = "Contact name must be 100 characters or fewer";
  if (value.contact.email && (!EMAIL.test(value.contact.email) || value.contact.email.length > 200)) errors["contact.email"] = "Enter a valid email address";
  if (value.contact.phone && !PHONE.test(value.contact.phone)) errors["contact.phone"] = "Enter a valid phone number";
  if (!value.contact.email && !value.contact.phone) errors["contact.email"] ||= "Give an email or phone number so vendors can reach you";

  const sourceUrl = text(pick("sourceUrl", existing?.sourceUrl ?? ""));
  if (sourceUrl) {
    const safe = typeof sourceUrl === "string" && sourceUrl.length <= 2000 ? httpsUrl(sourceUrl) : null;
    if (!safe) errors.sourceUrl = "Link must be a valid https:// URL";
    else value.sourceUrl = safe;
  } else value.sourceUrl = "";

  if (existing && body.procurementStatus !== undefined) {
    if (!["open", "closed"].includes(body.procurementStatus)) errors.procurementStatus = "Status must be open or closed";
    else value.procurementStatus = body.procurementStatus;
  }

  return { value, skillNames, errors };
}

// Fields every direct posting carries. Postings never enter the paid Vertex queue.
function directPostingDefaults({ publisherId, now = new Date() }) {
  return {
    source: DIRECT_SOURCE,
    status: "Public",
    classification: "software",
    classificationMethod: "publisher",
    procurementMethod: "Direct posting",
    procurementStatus: "open",
    deadlinePrecision: "datetime",
    announcedAt: now,
    publisherId,
    analysisStatus: "skipped",
    analysisAutoEligible: false,
    analysisSkipReason: "Direct job posting: no TOR documents to analyze",
    dataVerified: false,
  };
}

module.exports = { MAX_POSTING_SKILLS, validatePosting, directPostingDefaults };
