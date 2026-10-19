const Project = require("../src/models/Project");
const Skill = require("../src/models/Skill");
const { buildProjectQuery } = require("../src/services/ProjectSearch");
const { availability } = require("../src/services/ProcurementAvailability");
const { ingestionStatus } = require("../src/services/IngestionScheduler");

const fetch = async (req, res) => {
  try {
    const { query, page, limit } = await buildProjectQuery(req.query, async regex =>
      (await Skill.find({ name: regex }).select("_id").lean()).map(skill => skill._id));

    const [projects, total] = await Promise.all([
      Project.find(query)
        .populate("requiredSkills", "name category")
        .populate("publisherId", "username email")
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
      .populate("publisherId", "username email");

    if (!project || project.status !== "Public") return res.status(404).json({ message: "Project not found" });

    res.set("Cache-Control", "no-store");
    res.status(200).json({ ...project.toObject(), availability: availability(project) });
  } catch (error) {
    console.error("Fetch project error:", error);
    res.status(500).json({ error: "Server error while fetching project" });
  }
};

const create = async (req, res) => {
  try {
    if (!["JobLister", "Admin"].includes(req.user.role)) {
      return res.status(403).json({ message: "Only Job Listers can create postings" });
    }

    const { title, agency, description, budget, category, requiredSkills, status, sourceUrl, deadline } = req.body;

    const project = await Project.create({
      title,
      agency,
      description,
      budget,
      category,
      requiredSkills: requiredSkills || [],
      status: status || "Public",
      sourceUrl,
      deadline,
      publisherId: req.user._id,
    });

    res.status(201).json(project);
  } catch (error) {
    console.error("Create project error:", error);
    res.status(500).json({ error: "Server error while creating project" });
  }
};

const update = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id);
    if (!project) return res.status(404).json({ message: "Project not found" });

    const isOwner = project.publisherId?.toString() === req.user._id.toString();
    if (!isOwner && req.user.role !== "Admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    const EDITABLE_FIELDS = ["title", "agency", "description", "budget", "category", "requiredSkills", "status", "sourceUrl", "deadline"];
    const patch = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }
    if (patch.sourceUrl !== undefined && patch.sourceUrl !== project.sourceUrl) {
      Object.assign(patch, { analysisStatus: "pending", descriptions: "", requiredSkills: [],
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

module.exports = { fetch, fetchById, create, update, deleteProject };
