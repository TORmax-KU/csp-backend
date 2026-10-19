require("dotenv").config();
const mongoose = require("mongoose");
const Project = require("../src/models/Project");

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  // Existing documents predate the schema default. Only queue those never analyzed.
  const result = await Project.updateMany({ analysisStatus: { $exists: false }, sourceUrl: { $type: "string", $ne: "" } },
    { $set: { analysisStatus: "pending", analysisAttempts: 0, analysisError: "" } });
  console.log(`Queued ${result.modifiedCount} existing projects`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
