const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const { calculateMatch, resolveSkills } = require("../src/services/SkillMatching");
const Skill = require("../src/models/Skill");

async function queueAnalysis(req, res, next) {
  try {
    if (req.user.role !== "Admin") return res.status(403).json({ message: "Admin only" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid project ID" });
    if (String(process.env.VERTEX_AI_ENABLED).trim().toLowerCase() !== "true") return res.status(503).json({ message: "Vertex AI worker is disabled; configure credentials and enable it first" });
    const project = await Project.findOneAndUpdate({ _id: req.params.id, analysisStatus: { $ne: "processing" } },
      { $set: { analysisStatus: "pending", analysisError: "", analysisErrorCode: "", analysisRetryCount: 0 },
        $unset: { nextAnalysisAt: 1 } }, { returnDocument: "after" });
    if (!project) {
      return res.status(await Project.exists({ _id: req.params.id }) ? 409 : 404).json({ message: "Project missing or already processing" });
    }
    res.status(202).json({ projectId: project._id, analysisStatus: project.analysisStatus });
  } catch (error) { next(error); }
}

async function matchSkills(req, res, next) {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid project ID" });
    const project = await Project.findById(req.params.id).lean();
    if (!project) return res.status(404).json({ message: "Project not found" });
    // Re-resolve against the current catalog so admin-added skills need no paid re-analysis.
    if (project.analysisStatus === "completed" && project.aiAnalysis?.mandatorySkillNames?.length) {
      const mapped = resolveSkills(project.aiAnalysis.mandatorySkillNames, await Skill.find({}).select("name").lean());
      project.requiredSkills = mapped.requiredSkills;
      project.aiAnalysis.unmappedSkillNames = mapped.unmappedSkillNames;
    }
    res.json({ projectId: project._id, ...calculateMatch(project, req.user.proficiency),
      unmappedSkillNames: project.aiAnalysis?.unmappedSkillNames || [] });
  } catch (error) { next(error); }
}
module.exports = { queueAnalysis, matchSkills };
