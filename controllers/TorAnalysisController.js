const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const { calculateMatch, resolveSkills } = require("../src/services/SkillMatching");
const Skill = require("../src/models/Skill");
const { budgetFit, DEFAULT_THRESHOLD } = require("../src/services/MatchingEngine");

async function queueAnalysis(req, res, next) {
  try {
    if (req.user.role !== "Admin") return res.status(403).json({ message: "Admin only" });
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid project ID" });
    if (String(process.env.VERTEX_AI_ENABLED).trim().toLowerCase() !== "true") return res.status(503).json({ message: "Vertex AI worker is disabled; configure credentials and enable it first" });
    if (await Project.exists({ _id: req.params.id, analysisHold: true })) return res.status(409).json({ message: "Pending corrected TOR extraction; analysis is on hold" });
    const project = await Project.findOneAndUpdate({ _id: req.params.id, analysisHold: { $ne: true }, analysisStatus: { $ne: "processing" } },
      { $set: { analysisStatus: "pending", analysisAutoEligible: true, analysisSkipReason: "", analysisError: "", analysisErrorCode: "", analysisRetryCount: 0 },
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
    const catalog = await Skill.find({}).select("name").lean();
    // Re-resolve against the current catalog so admin-added skills need no paid re-analysis.
    if (project.analysisStatus === "completed" && project.aiAnalysis?.mandatorySkillNames?.length) {
      const mapped = resolveSkills(project.aiAnalysis.mandatorySkillNames, catalog);
      project.requiredSkills = mapped.requiredSkills;
      project.aiAnalysis.unmappedSkillNames = mapped.unmappedSkillNames;
    }
    const result = calculateMatch(project, req.user.proficiency);
    const names = new Map(catalog.map(skill => [String(skill._id), skill.name]));
    const named = ids => ids.map(id => ({ _id: id, name: names.get(id) })).filter(skill => skill.name);
    const matchThreshold = req.user.matchThreshold ?? DEFAULT_THRESHOLD;
    const budget = budgetFit(project, req.user);
    res.json({ projectId: project._id, ...result,
      unmappedSkillNames: project.aiAnalysis?.unmappedSkillNames || [],
      matchedSkills: named(result.matchedSkillIds), missingSkills: named(result.missingSkillIds),
      matchThreshold, budgetFit: budget,
      // Same rule as the matching engine, so this page agrees with match alerts.
      isMatch: result.matchPercentage !== null && result.matchPercentage >= matchThreshold && !["below", "above"].includes(budget) });
  } catch (error) { next(error); }
}
module.exports = { queueAnalysis, matchSkills };
