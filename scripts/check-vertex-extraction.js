require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { analyzeTor, PROMPT_VERSION } = require("../src/services/VertexTorAnalyzer");
const { loadTor } = require("../src/services/TorSource");

async function main() {
  const [mode, input] = process.argv.slice(2);
  if (!["--pdf", "--source"].includes(mode) || !input) throw new Error("Use --pdf <local PDF> or --source <official URL>. This check never writes to MongoDB.");
  const documents = mode === "--pdf" ? [{ url: path.basename(input), bytes: fs.readFileSync(input) }] : await loadTor(input);
  const analysis = await analyzeTor(documents, []);
  fs.mkdirSync("tmp", { recursive: true });
  fs.writeFileSync("tmp/vertex-extraction-check.json", JSON.stringify({ promptVersion: PROMPT_VERSION, documents: documents.map(d => d.url), analysis }, null, 2));
  console.log(JSON.stringify({ model: process.env.VERTEX_MODEL, promptVersion: PROMPT_VERSION, documents: documents.length, hasTorContent: analysis.hasTorContent,
    summaryCharacters: analysis.descriptions.length, skills: analysis.mandatorySkills,
    values: analysis.metadata.values, fields: analysis.metadata.fields, needsReview: analysis.metadata.needsReview,
    report: "tmp/vertex-extraction-check.json", databaseWrites: 0 }, null, 2));
}
main().catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
