// Read-only: detect fingerprints of the retired patch-demo-data script.
const mongoose = require("mongoose");
const Project = require("../src/models/Project");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const projects = await Project.find().lean();
  const candidates = projects.filter(p => {
    const announced = new Date(p.announcedAt).getTime();
    const start = new Date(p.submissionStartAt).getTime();
    const procurement = new Date(p.procurementStartAt).getTime();
    const verified = new Date(p.sourceVerifiedAt).getTime();
    // The script fabricated these exact relationships; a candidate still
    // requires source comparison before any data is changed.
    return (Number.isFinite(announced) && start - announced === 2 * 86400000 && procurement === announced)
      || (Number.isFinite(announced) && Number.isFinite(verified)
        && Array.from({ length: 10 }, (_, i) => i + 1).some(days =>
          Math.abs(verified - announced - days * 86400000) < 60000));
  });
  console.log(JSON.stringify({
    total: projects.length,
    withSourcePayload: projects.filter(p => p.rawData && Object.keys(p.rawData).length).length,
    withAnnouncementDate: projects.filter(p => p.announcedAt).length,
    candidates: candidates.map(p => ({
      id: p._id, source: p.source, announcedAt: p.announcedAt,
      deadline: p.deadline, sourceVerifiedAt: p.sourceVerifiedAt,
    })),
    withoutSourcePayload: projects.filter(p => !p.rawData || !Object.keys(p.rawData).length)
      .map(p => ({ id: p._id, title: p.title, source: p.source })),
  }, null, 2));
  await mongoose.disconnect();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
