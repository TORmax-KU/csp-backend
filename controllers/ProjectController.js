const Project = require("../src/models/Project");

const fetch = async (req, res) => {
  try {
    const { search, agency, status, priceFlag, minBudget, maxBudget, deadline, page = 1, limit = 10 } = req.query;

    const query = {};

    if (search) {
      const regex = { $regex: search, $options: "i" };
      query.$or = [{ title: regex }, { description: regex }, { agency: regex }];
    }
    if (agency) query.agency = { $regex: agency, $options: "i" };
    if (status) query.status = status;
    if (priceFlag) query.priceFlag = priceFlag;
    if (minBudget || maxBudget) {
      query.budget = {};
      if (minBudget) query.budget.$gte = Number(minBudget);
      if (maxBudget) query.budget.$lte = Number(maxBudget);
    }
    if (deadline) query.deadline = { $lte: new Date(deadline) };

    const [projects, total] = await Promise.all([
      Project.find(query)
        .populate("requiredSkills", "name category")
        .populate("publisherId", "username email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      Project.countDocuments(query),
    ]);

    res.status(200).json({ projects, total, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Fetch projects error:", error);
    res.status(500).json({ error: "Server error while fetching projects" });
  }
};

const fetchById = async (req, res) => {
  try {
    const project = await Project.findById(req.params.id)
      .populate("requiredSkills", "name category")
      .populate("publisherId", "username email");

    if (!project) return res.status(404).json({ message: "Project not found" });

    res.status(200).json(project);
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
