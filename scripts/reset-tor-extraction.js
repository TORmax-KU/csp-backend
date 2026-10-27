require("dotenv").config();
const { MongoClient } = require("mongoose").mongo;
const { pendingTorExtraction } = require("../src/services/PendingTorExtraction");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  const client = new MongoClient(process.env.MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    if (db.databaseName !== "tormax_dev") throw new Error("Expected tormax_dev; refusing to reset another database");
    const projects = db.collection("projects");
    const records = await projects.find({}).toArray();
    if (!process.argv.includes("--apply")) {
      console.log(JSON.stringify({ database: db.databaseName, projects: records.length, dryRun: true }));
      return;
    }
    if (!records.length) throw new Error("No projects found");
    const backupName = `projects_before_extraction_reset_${Date.now()}`;
    const backup = await db.createCollection(backupName);
    await backup.insertMany(records, { ordered: true });
    if (await backup.countDocuments() !== records.length) throw new Error("Backup count mismatch; reset aborted");
    const result = await projects.updateMany({ _id: { $in: records.map(p => p._id) } }, [
      { $set: { ...Object.fromEntries(Object.entries(pendingTorExtraction()).map(([key, value]) => [key, { $literal: value }])),
        procurementStatus: { $cond: [{ $in: ["$procurementStatus", ["awarded", "cancelled", "draft"]] }, "$procurementStatus", "unknown"] },
        updatedAt: "$$NOW",
      } },
    ]);
    const remaining = await projects.countDocuments({ _id: { $in: records.map(p => p._id) }, $or: [
      { budget: { $ne: null } }, { announcedAt: { $ne: null } }, { deadline: { $ne: null } },
      { descriptions: { $ne: "" } }, { "requiredSkills.0": { $exists: true } },
      { "sourceSkillNames.0": { $exists: true } }, { analysisHold: { $ne: true } }, { analysisStatus: { $ne: "pending" } },
    ] });
    console.log(JSON.stringify({ database: db.databaseName, backupCollection: backupName, backedUp: records.length, matched: result.matchedCount, modified: result.modifiedCount, remainingIncorrect: remaining }));
    if (remaining) throw new Error("Reset verification failed");
  } finally { await client.close(); }
}
main().catch(error => { console.error(error.name + ": " + error.message); process.exitCode = 1; });
