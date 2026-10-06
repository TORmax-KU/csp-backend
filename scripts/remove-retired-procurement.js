require("dotenv").config();
const mongoose = require("mongoose");

async function main() {
  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fullstack_db");
  const db = mongoose.connection.db;
  const filter = { source: "bangkok-egp", publisherId: null };
  const ids = (await db.collection("projects").find(filter, { projection: { _id: 1 } }).toArray()).map(row => row._id);
  console.log(JSON.stringify({ database: db.databaseName, retiredProjects: ids.length, apply: process.argv.includes("--apply") }));
  if (!process.argv.includes("--apply")) return;
  const matches = await db.collection("matches").deleteMany({ projectId: { $in: ids } });
  const notifications = await db.collection("notifications").deleteMany({ projectId: { $in: ids } });
  const projects = await db.collection("projects").deleteMany({ ...filter, _id: { $in: ids } });
  console.log(JSON.stringify({ projectsDeleted: projects.deletedCount, matchesDeleted: matches.deletedCount, notificationsDeleted: notifications.deletedCount }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
