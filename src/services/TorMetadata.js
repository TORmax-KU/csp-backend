const { analysisError } = require("./AnalysisErrors");
const FIELDS = ["budget", "announcedAt", "deadline"];
const evidenceSchema = { type: "OBJECT", nullable: true, required: ["quote", "page", "documentIndex"], properties: {
  quote: { type: "STRING" }, page: { type: "INTEGER" }, documentIndex: { type: "INTEGER" },
} };
const common = { status: { type: "STRING", enum: ["found", "not_found", "ambiguous"] }, reason: { type: "STRING" }, evidence: evidenceSchema };
const dateSchema = { type: "OBJECT", required: ["status", "reason", "evidence", "day", "month", "year", "calendar", "time"], properties: {
  ...common, day: { type: "INTEGER", nullable: true }, month: { type: "INTEGER", nullable: true }, year: { type: "INTEGER", nullable: true },
  calendar: { type: "STRING", enum: ["BE", "CE"], nullable: true }, time: { type: "STRING", nullable: true },
} };
const metadataSchema = { type: "OBJECT", required: FIELDS, properties: {
  budget: { type: "OBJECT", required: ["status", "reason", "evidence", "amountTHB"], properties: { ...common, amountTHB: { type: "NUMBER", nullable: true } } },
  announcedAt: dateSchema, deadline: dateSchema,
} };
const digits = value => String(value).replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - 0x0e50));

function validEvidence(evidence, count) {
  return evidence && typeof evidence.quote === "string" && evidence.quote.trim().length > 0 && evidence.quote.length <= 1600 &&
    Number.isInteger(evidence.page) && evidence.page > 0 && Number.isInteger(evidence.documentIndex) && evidence.documentIndex > 0 && evidence.documentIndex <= count;
}

function normalizeDate(field, evidence, now) {
  if (![field.day, field.month, field.year].every(Number.isInteger) || !["BE", "CE"].includes(field.calendar)) throw new Error("Incomplete date or calendar");
  // The model must return the printed year, never a guessed or already-converted year.
  const printedYears = digits(evidence.quote).match(/\d{4}/g) || [];
  if (!printedYears.includes(String(field.year))) throw new Error("Printed year is absent from the cited text");
  const printed = digits(evidence.quote);
  const months = [
    ["มกราคม", "มค", "january", "jan"], ["กุมภาพันธ์", "กพ", "february", "feb"], ["มีนาคม", "มีค", "march", "mar"],
    ["เมษายน", "เมย", "april", "apr"], ["พฤษภาคม", "พค", "may"], ["มิถุนายน", "มิย", "june", "jun"],
    ["กรกฎาคม", "กค", "july", "jul"], ["สิงหาคม", "สค", "august", "aug"], ["กันยายน", "กย", "september", "sep"],
    ["ตุลาคม", "ตค", "october", "oct"], ["พฤศจิกายน", "พย", "november", "nov"], ["ธันวาคม", "ธค", "december", "dec"],
  ];
  const compact = printed.toLowerCase().replace(/[.\s]/g, "");
  const namedMonth = months[field.month - 1]?.some(name => compact.includes(name));
  const numericDate = new RegExp(`(?:^|[^0-9])0?${field.day}[/-]0?${field.month}[/-]${field.year}(?:[^0-9]|$)`).test(printed) ||
    new RegExp(`${field.year}-0?${field.month}-0?${field.day}(?:[^0-9]|$)`).test(printed);
  if (!numericDate && !(namedMonth && new RegExp(`(?:^|[^0-9])0?${field.day}(?:[^0-9]|$)`).test(printed))) throw new Error("Day or month is absent from cited date");
  const year = field.calendar === "BE" ? field.year - 543 : field.year;
  if (year < 1990 || year > now.getUTCFullYear() + 5) throw new Error("Implausible procurement year");
  const day = new Date(Date.UTC(year, field.month - 1, field.day));
  if (day.getUTCFullYear() !== year || day.getUTCMonth() !== field.month - 1 || day.getUTCDate() !== field.day) throw new Error("Invalid calendar date");
  const iso = `${year}-${String(field.month).padStart(2, "0")}-${String(field.day).padStart(2, "0")}`;
  if (field.time !== null) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(field.time)) throw new Error("Invalid submission time");
    const [hours, minutes] = field.time.split(":");
    const printed = digits(evidence.quote).replace(/\s/g, "");
    if (!new RegExp(`(?:^|[^0-9])0?${Number(hours)}[.:]${minutes}(?:[^0-9]|$)`).test(printed)) throw new Error("Submission time is absent from cited text");
  }
  return field.time === null ? iso : `${iso}T${field.time}:00+07:00`;
}

function validateMetadata(metadata, documentCount, now = new Date()) {
  if (!metadata || FIELDS.some(name => !metadata[name])) throw analysisError("INVALID_AI_RESPONSE", "Budget and date extraction results are required");
  const values = { budget: null, announcedAt: null, deadline: null, deadlinePrecision: "unknown" };
  const fields = {};
  for (const name of FIELDS) {
    const input = metadata[name];
    if (!["found", "not_found", "ambiguous"].includes(input.status) || typeof input.reason !== "string" || input.reason.length > 2000) throw analysisError("INVALID_AI_RESPONSE", `Invalid ${name} extraction status`);
    fields[name] = { status: input.status, reason: input.reason, evidence: null };
    if (input.status !== "found") {
      if (!input.reason.trim()) throw analysisError("INVALID_AI_RESPONSE", `Missing ${name} explanation`);
      continue;
    }
    try {
      if (!validEvidence(input.evidence, documentCount)) throw new Error("Missing valid quote, page or document index");
      const quote = digits(input.evidence.quote);
      if (name === "budget") {
        if (!Number.isFinite(input.amountTHB) || input.amountTHB <= 0 || input.amountTHB > 1e13) throw new Error("Invalid THB budget");
        if (!/วงเงิน|งบประมาณ|budget/i.test(quote)) throw new Error("Quote does not identify a project budget");
        const amounts = quote.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || [];
        if (!amounts.some(amount => Math.abs(Number(amount) - input.amountTHB) < 0.005 || (/ล้าน|million/i.test(quote) && Math.abs(Number(amount) * 1e6 - input.amountTHB) < 0.005))) throw new Error("Budget is not supported by the quoted amount");
        values.budget = input.amountTHB;
      } else {
        const cues = name === "announcedAt" ? /ประกาศ|เผยแพร่|publish|announce/i : /ยื่น|เสนอราคา|submission|deadline|bid/i;
        if (!cues.test(quote)) throw new Error("Quote does not identify the requested date event");
        if (name === "announcedAt" && input.time !== null) throw new Error("Publication must be a date without invented time");
        values[name] = normalizeDate(input, input.evidence, now);
        if (name === "deadline") values.deadlinePrecision = input.time === null ? "date" : "datetime";
      }
      fields[name].evidence = input.evidence;
    } catch (error) {
      fields[name] = { status: "ambiguous", reason: error.message, evidence: validEvidence(input.evidence, documentCount) ? input.evidence : null };
    }
  }
  if (values.announcedAt && values.deadline && values.deadline.slice(0, 10) < values.announcedAt) {
    values.deadline = null;
    values.deadlinePrecision = "unknown";
    fields.deadline.status = "ambiguous";
    fields.deadline.reason = "Submission deadline precedes announcement publication date";
  }
  return { values, fields, needsReview: Object.values(fields).some(field => field.status === "ambiguous") };
}

module.exports = { metadataSchema, validateMetadata };
