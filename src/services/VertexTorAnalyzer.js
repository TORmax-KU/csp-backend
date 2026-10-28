const { analysisError } = require("./AnalysisErrors");
const { metadataSchema, validateMetadata } = require("./TorMetadata");
const SYSTEM_INSTRUCTION = require("./TorExtractionPrompt");
const PROMPT_VERSION = "tor-pdf-v4-reading-order";

function validateAnalysis(value, documentCount = 5) {
  if (!value || typeof value.hasTorContent !== "boolean" || typeof value.descriptions !== "string" ||
      (value.hasTorContent && !value.descriptions.trim()) || value.descriptions.length > 20000 ||
      !Array.isArray(value.mandatorySkills) || value.mandatorySkills.length > 60 ||
      value.mandatorySkills.some(s => typeof s !== "string" || !s.trim() || s.length > 60)) {
    throw analysisError("INVALID_AI_RESPONSE", "AI returned invalid summary or mandatory skill names");
  }
  const mandatorySkills = [...new Set(value.mandatorySkills.map(s => s.trim()))];
  const evidence = value.skillEvidence;
  if (!Array.isArray(evidence) || evidence.length > 60 || evidence.some(e =>
    !e || !mandatorySkills.includes(e.name) || typeof e.quote !== "string" || !e.quote.trim() || e.quote.length > 1200 ||
    !Number.isInteger(e.page) || e.page < 1 || !Number.isInteger(e.documentIndex) || e.documentIndex < 1 || e.documentIndex > documentCount) ||
    mandatorySkills.some(name => !evidence.some(e => e.name === name))) {
    throw analysisError("INVALID_AI_RESPONSE", "Each mandatory skill needs a TOR quote, page and document index");
  }
  if (typeof value.noMandatorySkillsReason !== "string" || value.noMandatorySkillsReason.length > 2000 ||
      (!mandatorySkills.length && !value.noMandatorySkillsReason.trim())) {
    throw analysisError("INVALID_AI_RESPONSE", "Empty mandatory skills require an explanation");
  }
  if (!value.hasTorContent && (value.descriptions.trim() || mandatorySkills.length || evidence.length)) throw analysisError("INVALID_AI_RESPONSE", "Scope and skills must be empty without TOR content");
  return { hasTorContent: value.hasTorContent, descriptions: value.descriptions.trim(), mandatorySkills, skillEvidence: evidence,
    noMandatorySkillsReason: value.noMandatorySkillsReason.trim(), metadata: validateMetadata(value.metadata, documentCount) };
}

function vertexConfig() {
  if (!process.env.GOOGLE_CLOUD_PROJECT || !process.env.VERTEX_MODEL) {
    throw new Error("Configure GOOGLE_CLOUD_PROJECT and VERTEX_MODEL before enabling analysis");
  }
  return { vertexai: true, project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION || "global", httpOptions: { timeout: 120000 } };
}

async function analyzeTor(documents, skillNames, context = {}, options = {}) {
  const { GoogleGenAI } = require("@google/genai");
  const client = new GoogleGenAI({ ...vertexConfig(), ...options.clientOptions });
  const { PDFParse } = require("pdf-parse");
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { readingOrder } = require('./PdfReadingOrder');
  const pages = [];
  for (const document of documents) {
    const parser = new PDFParse({ data: document.bytes });
    try {
      const text = await parser.getText();
      if (text.total > 200) throw analysisError("DOCUMENT_LIMIT", "PDF exceeds 200 pages");
      pages.push(text.pages.map(page => page.text));
    } finally { await parser.destroy(); }
    const task = getDocument({ data: new Uint8Array(document.bytes), verbosity: 0 });
    try {
      const pdf = await task.promise;
      const layouts = [];
      for (let page = 1; page <= pdf.numPages; page++) {
        const content = await (await pdf.getPage(page)).getTextContent();
        layouts.push(readingOrder(content.items));
      }
      // Either extraction must contain the entire quote on its cited page.
      pages[pages.length - 1] = pages.at(-1).map((raw, i) => ({ raw, layout: layouts[i] }));
    } finally { await task.destroy(); }
  }
  const request = {
    model: process.env.VERTEX_MODEL,
    contents: [{ role: "user", parts: [
      { text: `Project identification only: ${JSON.stringify({ title: context.title, externalId: context.externalId })}. Existing skill vocabulary (exact names where equivalent): ${JSON.stringify(skillNames)}.` },
      ...documents.flatMap((d, i) => [{ text: `Document ${i + 1}: ${pages[i].length} pages. Citation documentIndex is ${i + 1}; page numbers restart at 1 within this PDF. Use physical PDF page numbers, not a printed page number or a combined-document page count.` }, { inlineData: { mimeType: "application/pdf", data: d.bytes.toString("base64") } }]),
    ] }],
    config: {
      temperature: 0,
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: { type: "OBJECT", required: ["hasTorContent", "descriptions", "mandatorySkills", "skillEvidence", "noMandatorySkillsReason", "metadata"], properties: {
        metadata: metadataSchema,
        hasTorContent: { type: "BOOLEAN" }, descriptions: { type: "STRING" },
        mandatorySkills: { type: "ARRAY", items: { type: "STRING" } },
        noMandatorySkillsReason: { type: "STRING" },
        skillEvidence: { type: "ARRAY", items: { type: "OBJECT", required: ["name", "quote", "page", "documentIndex"], properties: {
          name: { type: "STRING" }, quote: { type: "STRING" }, page: { type: "INTEGER" }, documentIndex: { type: "INTEGER" },
        } } },
      } },
    },
  };
  const normalize = text => String(text).normalize("NFKC").replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - 0x0e50)).replace(/[^\p{L}\p{N}]/gu, "");
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.models.generateContent(request);
    let value;
    try { value = JSON.parse(response.text); }
    catch { throw analysisError("INVALID_AI_RESPONSE", "AI did not return valid JSON"); }
    const parsed = validateAnalysis(value, documents.length);
    const citationIssue = evidence => {
      const page = pages[evidence.documentIndex - 1]?.[evidence.page - 1];
      if (page === undefined) return "Cited PDF page does not exist";
      // Scanned PDFs have no text layer; retain the model's visual citation.
      if (normalize(page.raw).length > 100 && ![page.raw, page.layout || ''].some(text => normalize(text).includes(normalize(evidence.quote)))) return "Verbatim quote does not match the cited PDF text layer";
      return null;
    };
    const skillIssues = parsed.skillEvidence.map(evidence => ({ name: evidence.name, ...evidence, issue: citationIssue(evidence) })).filter(e => e.issue);
    if (skillIssues.length) {
      if (!attempt) {
        request.contents[0].parts.push({ text: `Correct these invalid skill citations: ${JSON.stringify(skillIssues)}. Physical page counts by document: ${JSON.stringify(pages.map(p => p.length))}. Re-read the PDFs and return the full schema. Each quote must exist on the specified physical page within its document. Keep only requirements actually supported by the TOR; do not invent evidence.` });
        continue;
      }
      throw analysisError('INVALID_AI_RESPONSE', skillIssues[0].issue);
    }
    for (const [name, field] of Object.entries(parsed.metadata.fields)) {
      if (field.status !== "found") continue;
      const issue = citationIssue(field.evidence);
      if (issue) {
        field.status = "ambiguous"; field.reason = issue;
        parsed.metadata.values[name] = null;
        if (name === "deadline") parsed.metadata.values.deadlinePrecision = "unknown";
        parsed.metadata.needsReview = true;
      }
    }
    const corrections = Object.entries(parsed.metadata.fields).filter(([name, field]) => field.status === "ambiguous" && value.metadata[name].status === "found").map(([name, field]) => ({ field: name, problem: field.reason, quote: field.evidence?.quote }));
    if (!attempt && corrections.length) {
      request.contents[0].parts.push({ text: `Re-read the PDFs and correct these validation failures: ${JSON.stringify(corrections)}. Return the full schema again. For date evidence quote the COMPLETE sentence including the preceding event words (such as ผู้ประสงค์จะเสนอราคาต้องยื่นข้อเสนอ), date, year and final time; date fragments alone are insufficient. Do not invent evidence to pass validation. If unsupported return not_found or ambiguous with null values.` });
      continue;
    }
    return parsed;
  }
}

module.exports = { analyzeTor, validateAnalysis, vertexConfig, PROMPT_VERSION };
