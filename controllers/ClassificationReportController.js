const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const ClassificationReport = require("../src/models/ClassificationReport");
const { REPORT_REASONS, REPORT_STATUSES } = require("../schemas/ClassificationReportModel");
const { DIRECT_SOURCE } = require("../src/services/ProcurementAvailability");

const MAX_NOTE = 500;

// Open Issue 2: any signed-in user can flag a government TOR as misclassified.
// Reporting again replaces the user's earlier report and reopens it.
const reportClassification = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Project not found" });
    const { reason } = req.body || {};
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!REPORT_REASONS.includes(reason)) return res.status(400).json({ message: "Choose a reason", errors: { reason: "Choose a reason" } });
    if (note.length > MAX_NOTE) return res.status(400).json({ message: `Note must be ${MAX_NOTE} characters or fewer`, errors: { note: `Note must be ${MAX_NOTE} characters or fewer` } });
    if (reason === "other" && !note) return res.status(400).json({ message: "Describe the problem", errors: { note: "Describe the problem" } });

    const project = await Project.findById(req.params.id).select("status source").lean();
    // Direct postings are publisher-declared, not classified; abuse goes through moderation instead.
    if (!project || project.status !== "Public" || project.source === DIRECT_SOURCE) return res.status(404).json({ message: "Project not found" });

    const report = await ClassificationReport.findOneAndUpdate(
      { projectId: req.params.id, userId: req.user._id },
      { $set: { reason, note, status: "open", resolvedBy: null, resolvedAt: null } },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    res.status(200).json({ reported: true, reason: report.reason, reportedAt: report.updatedAt });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Report already being saved; try again" });
    console.error("Report classification error:", error);
    res.status(500).json({ error: "Server error while saving the report" });
  }
};

// Admin review queue, newest first.
const fetchClassificationReports = async (req, res) => {
  try {
    const status = req.query.status || "open";
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!REPORT_STATUSES.includes(status) && status !== "all") return res.status(400).json({ error: "Invalid status" });
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Page must be a positive integer and limit between 1 and 100" });
    }
    const query = status === "all" ? {} : { status };
    const [reports, total] = await Promise.all([
      ClassificationReport.find(query)
        .populate("projectId", "title agency source externalId classification category priceAnalysis.category")
        .populate("userId", "email realName role")
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      ClassificationReport.countDocuments(query),
    ]);
    res.status(200).json({ reports, total, page, limit });
  } catch (error) {
    console.error("Fetch classification reports error:", error);
    res.status(500).json({ error: "Server error while fetching reports" });
  }
};

// Resolve or dismiss a report. `markNonSoftware: true` also removes the TOR from the IT feed and
// resolves every open report on it.
const reviewClassificationReport = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Report not found" });
    const { status, markNonSoftware = false } = req.body || {};
    if (!REPORT_STATUSES.includes(status)) return res.status(400).json({ message: "Status must be open, resolved or dismissed" });
    if (markNonSoftware && status !== "resolved") return res.status(400).json({ message: "Only a resolved report can reclassify the TOR" });

    const report = await ClassificationReport.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    const closed = status === "open" ? { resolvedBy: null, resolvedAt: null } : { resolvedBy: req.user._id, resolvedAt: new Date() };

    if (markNonSoftware) {
      await Project.updateOne({ _id: report.projectId }, { $set: { classification: "non-software", classificationMethod: "admin-report" } });
      await ClassificationReport.updateMany({ projectId: report.projectId, status: "open" }, { $set: { status: "resolved", ...closed } });
    }
    Object.assign(report, { status, ...closed });
    await report.save();
    res.status(200).json(report);
  } catch (error) {
    console.error("Review classification report error:", error);
    res.status(500).json({ error: "Server error while updating the report" });
  }
};

module.exports = { reportClassification, fetchClassificationReports, reviewClassificationReport };
