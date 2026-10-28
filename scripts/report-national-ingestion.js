require('dotenv').config({ quiet: true });
const mongoose = require('mongoose');
const Project = require('../src/models/Project');
const Log = require('../src/models/IngestionLog');
(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const filter = { source: { $in: ['tero-procurement', 'govspending'] } };
  const counts = await Project.aggregate([{ $match: filter }, { $group: { _id: { source: '$source', analysis: '$analysisStatus' }, count: { $sum: 1 } } }]);
  const recent = await Project.find(filter).sort({ analyzedAt: -1 }).limit(12)
    .select('externalId title source analysisStatus analysisErrorCode analyzedAt budget announcedAt deadline procurementStatus').lean();
  const logs = await Log.find(filter).sort({ createdAt: -1, _id: -1 }).limit(4).select('source status projectsCreated projectsUpdated projectsFiltered startedAt finishedAt').lean();
  const response = await fetch('http://localhost:5000/api/projects?availability=open&limit=100');
  const feed = await response.json();
  console.log(JSON.stringify({ checkedAt: new Date(), counts, recent, logs, publicCount: feed.total,
    publicProjects: feed.projects?.map(p => ({ id: p.externalId, title: p.title, budget: p.budget, deadline: p.deadline, source: p.source })) }, null, 2));
  await mongoose.disconnect();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
