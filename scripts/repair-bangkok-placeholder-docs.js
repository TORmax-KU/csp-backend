const mongoose = require("mongoose");
const Project = require("../src/models/Project");

async function main() {
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is required");
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const projects = await Project.find({ source: "bangkok-egp" })
      .select("_id sourceUrl documents").lean();
    const ids = projects
      .filter(project => project.documents?.length === 1 &&
        project.documents[0].url === project.sourceUrl)
      .map(project => project._id);
    if (!process.argv.includes("--apply")) {
      console.log(JSON.stringify({ placeholdersFound: ids.length, repaired: 0 }));
      return;
    }
    const result = await Project.updateMany({ _id: { $in: ids } }, {
      $set: { documents: [], dataVerified: false, sourceVerifiedAt: null },
    });
    console.log(JSON.stringify({ placeholdersFound: ids.length, repaired: result.modifiedCount }));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
