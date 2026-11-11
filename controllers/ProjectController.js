const Project = require("../src/models/Project");
const Skill = require("../src/models/Skill");
const { buildProjectQuery } = require("../src/services/ProjectSearch");
const { availability, DIRECT_SOURCE } = require("../src/services/ProcurementAvailability");
const { ingestionStatus } = require("../src/services/IngestionScheduler");
const { pendingTorExtraction } = require("../src/services/PendingTorExtraction");
const mongoose = require("mongoose");
const { validatePosting, directPostingDefaults } = require("../src/services/DirectPosting");
const { findOrCreateSkill } = require("../src/services/SkillCatalog");
const { assessProject } = require("../src/services/PriceAnalysis");
const { requestMatching } = require("../src/services/MatchingEngine");

const PUBLISHER_FIELDS = "username realName companyName";

// Direct postings are flagged against government benchmarks but never feed them, so only the
// saved posting needs assessing. Matching runs right away so vendors are notified (UC4).
async function afterPostingSaved(project) {
  const verdict = await assessProject(project);
  const saved = await Project.findByIdAndUpdate(project._id, { $set: verdict }, { new: true })
    .populate("requiredSkills", "name category").populate("publisherId", PUBLISHER_FIELDS);
  requestMatching(1000);
  return saved;
}

const validationFailed = (res, errors) => res.status(400).json({ message: "Please fix the highlighted fields", errors });

const fetch = async (req, res) => {
  try {
    const { query, page, limit } = await buildProjectQuery(req.query, async regex =>
      (await Skill.find({ name: regex }).select("_id").lean()).map(skill => skill._id));

    const [projects, total] = await Promise.all([
      Project.find(query)
        .populate("requiredSkills", "name category")
        .populate("publisherId", PUBLISHER_FIELDS)
        .select("-rawData -analysisError -analysisLease")
        .sort(req.query.sort === "newest" ? { announcedAt: -1, _id: -1 } : req.query.sort === "budget" ? { budget: -1, _id: -1 } : { deadline: 1, _id: 1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      Project.countDocuments(query),
    ]);

    res.set("Cache-Control", "no-store");
    res.status(200).json({ projects: projects.map(p => ({ ...p.toObject(), availability: availability(p) })), total, page: Number(page), limit: Number(limit), ingestion: ingestionStatus() });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    console.error("Fetch projects error:", error);
    res.status(500).json({ error: "Server error while fetching projects" });
  }
};

const fetchById = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: "Project not found" });
    const project = await Project.findById(req.params.id)
      .select("-rawData -analysisError -analysisLease")
      .populate("requiredSkills", "name category")
      .populate("publisherId", PUBLISHER_FIELDS);

    if (!project || project.status !== "Public") return res.status(404).json({ message: "Project not found" });

    res.set("Cache-Control", "no-store");
    res.status(200).json({ ...project.toObject(), availability: availability(project) });
  } catch (error) {
    console.error("Fetch project error:", error);
    res.status(500).json({ error: "Server error while fetching project" });
  }
};

// FR-13 / US6: a Job Lister's own postings, newest first, including closed ones.
const fetchMine = async (req, res) => {
  try {
    const projects = await Project.find({ source: DIRECT_SOURCE, publisherId: req.user._id })
      .select("-rawData -analysisError -analysisLease")
      .populate("requiredSkills", "name category")
      .sort({ createdAt: -1, _id: -1 })
      .limit(200);
    res.set("Cache-Control", "no-store");
    res.status(200).json({ projects: projects.map(p => ({ ...p.toObject(), availability: availability(p) })) });
  } catch (error) {
    console.error("Fetch own postings error:", error);
    res.status(500).json({ error: "Server error while fetching your postings" });
  }
};

// Job Listers publish direct postings (FR-13, UC4). Admins instead register a government TOR
// by URL, which is queued for AI extraction rather than trusting submitted metadata.
const create = async (req, res) => {
  try {
    if (req.user.role === "JobLister") return await createPosting(req, res);
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Only Job Listers can create postings" });
    }

    const { title, agency, description, category, status, sourceUrl } = req.body;

    const project = await Project.create({
      title,
      agency,
      description,
      category,
      status: status || "Public",
      sourceUrl,
      publisherId: req.user._id,
      ...pendingTorExtraction(),
      analysisHold: false,
      procurementStatus: "unknown",
    });

    res.status(201).json(project);
  } catch (error) {
    console.error("Create project error:", error);
    res.status(500).json({ error: "Server error while creating project" });
  }
};

async function createPosting(req, res) {
  const now = new Date();
  const { value, skillNames, errors } = validatePosting(req.body, { now });
  if (Object.keys(errors).length) return validationFailed(res, errors);

  const skills = await Promise.all(skillNames.map(findOrCreateSkill));
  const _id = new mongoose.Types.ObjectId();
  const project = await Project.create({
    _id,
    ...value,
    // Unique per posting: (source, externalId) has a unique index.
    externalId: `TMX-${String(_id).slice(-10).toUpperCase()}`,
    requiredSkills: skills.map(skill => skill._id),
    sourceSkillNames: skills.map(skill => skill.name),
    ...directPostingDefaults({ publisherId: req.user._id, now }),
  });
  const saved = await afterPostingSaved(project.toObject());
  res.status(201).json({ ...saved.toObject(), availability: availability(saved) });
}

const update = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const isOwner = project.publisherId?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (project.source === DIRECT_SOURCE) return await updatePosting(req, res, project);

    const EDITABLE_FIELDS = ["title", "agency", "description", "category", "status", "sourceUrl"];
    const patch = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    if (patch.sourceUrl !== undefined && patch.sourceUrl !== project.sourceUrl) {
      Object.assign(patch, { ...pendingTorExtraction(), analysisHold: false, procurementStatus: "unknown",
        analysisStatus: project.analysisAutoEligible === false ? "skipped" : "pending", descriptions: "", requiredSkills: [],
        aiAnalysis: {}, analysisError: "", analysisErrorCode: "", analysisRetryCount: 0, nextAnalysisAt: null,
        analysisLease: null, analysisLeaseUntil: null, analyzedAt: null });
    }

    // priceFlag is system-managed; only admins may override it
    if (req.body.priceFlag !== undefined && req.user.role === "Admin") {
      patch.priceFlag = req.body.priceFlag;
    }

    const updated = await Project.findByIdAndUpdate(req.params.id, patch, {
      new: true,
      runValidators: true,
    }).populate("requiredSkills", "name category");

    res.status(200).json(updated);
  } catch (error) {
    console.error("Update project error:", error);
    res.status(500).json({ error: "Server error while updating project" });
  }
};

async function updatePosting(req, res, project) {
  const { value, skillNames, errors } = validatePosting(req.body, { existing: project.toObject() });
  if (Object.keys(errors).length) return validationFailed(res, errors);

  const patch = { ...value };
  if (skillNames) {
    const skills = await Promise.all(skillNames.map(findOrCreateSkill));
    patch.requiredSkills = skills.map(skill => skill._id);
    patch.sourceSkillNames = skills.map(skill => skill.name);
  }
  const updated = await Project.findByIdAndUpdate(project._id, { $set: patch }, { new: true, runValidators: true });
  const saved = await afterPostingSaved(updated.toObject());
  res.status(200).json({ ...saved.toObject(), availability: availability(saved) });
}

const deleteProject = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const isOwner = project.publisherId?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    await Project.findByIdAndDelete(req.params.id);
    res.status(200).json({ message: "Project deleted" });
  } catch (error) {
    console.error("Delete project error:", error);
    res.status(500).json({ error: "Server error while deleting project" });
  }
};

module.exports = { fetch, fetchById, fetchMine, create, update, deleteProject };
