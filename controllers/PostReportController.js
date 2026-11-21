const mongoose = require("mongoose");
const Project = require("../src/models/Project");
const PostReport = require("../src/models/PostReport");
const { POST_REPORT_REASONS, POST_REPORT_STATUSES } = require("../schemas/PostReportModel");
const { DIRECT_SOURCE } = require("../src/services/ProcurementAvailability");

const MAX_NOTE = 500;

// UC5: any signed-in user can flag a direct job posting that breaks platform policy.
// Reporting again replaces the user's earlier report and reopens it.
const reportPost = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Posting not found" });
    const { reason } = req.body || {};
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (!POST_REPORT_REASONS.includes(reason)) return res.status(400).json({ message: "Choose a reason", errors: { reason: "Choose a reason" } });
    if (note.length > MAX_NOTE) return res.status(400).json({ message: `Note must be ${MAX_NOTE} characters or fewer`, errors: { note: `Note must be ${MAX_NOTE} characters or fewer` } });
    if (reason === "other" && !note) return res.status(400).json({ message: "Describe the problem", errors: { note: "Describe the problem" } });

    const project = await Project.findById(req.params.id).select("title status source publisherId").lean();
    // Government TORs are reported as misclassified instead (classification-report).
    if (!project || project.status !== "Public" || project.source !== DIRECT_SOURCE) return res.status(404).json({ message: "Posting not found" });
    if (project.publisherId && String(project.publisherId) === String(req.user._id)) {
      return res.status(400).json({ message: "You cannot report your own posting" });
    }

    const report = await PostReport.findOneAndUpdate(
      { projectId: project._id, userId: req.user._id },
      { $set: { reason, note, projectTitle: project.title || "", status: "open", outcome: "", resolvedBy: null, resolvedAt: null } },
      { upsert: true, returnDocument: "after", runValidators: true, setDefaultsOnInsert: true },
    ).lean();
    res.status(200).json({ reported: true, reason: report.reason, reportedAt: report.updatedAt });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: "Report already being saved; try again" });
    console.error("Report post error:", error);
    res.status(500).json({ error: "Server error while saving the report" });
  }
};

// Admin review queue, newest first. A removed posting populates as null; projectTitle keeps its name.
const fetchPostReports = async (req, res) => {
  try {
    const status = req.query.status || "open";
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (typeof status !== "string" || (!POST_REPORT_STATUSES.includes(status) && status !== "all")) return res.status(400).json({ error: "Invalid status" });
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Page must be a positive integer and limit between 1 and 100" });
    }
    // Rebuild the filter from a hardcoded literal, never the request value itself,
    // so no user-controlled data can reach the Mongoose query (ASVS V1.2.4).
    const query = {};
    if (status === "open") query.status = "open";
    else if (status === "resolved") query.status = "resolved";
    else if (status === "dismissed") query.status = "dismissed";
    const [reports, total] = await Promise.all([
      PostReport.find(query)
        .populate({ path: "projectId", select: "title agency externalId procurementStatus deadline contact publisherId",
          populate: { path: "publisherId", select: "email realName companyName status role" } })
        .populate("userId", "email realName role")
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * limit).limit(limit).lean(),
      PostReport.countDocuments(query),
    ]);
    res.set("Cache-Control", "no-store");
    res.status(200).json({ reports, total, page, limit });
  } catch (error) {
    console.error("Fetch post reports error:", error);
    res.status(500).json({ error: "Server error while fetching reports" });
  }
};

// Dismiss, resolve or reopen a report. Removing the posting itself goes through DELETE /api/admin/posts/:id.
const reviewPostReport = async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: "Report not found" });
    const { status } = req.body || {};
    if (!POST_REPORT_STATUSES.includes(status)) return res.status(400).json({ message: "Status must be open, resolved or dismissed" });

    const report = await PostReport.findById(req.params.id);
    if (!report) return res.status(404).json({ message: "Report not found" });
    if (report.outcome === "removed" && status === "open") return res.status(400).json({ message: "The posting was already removed" });
    Object.assign(report, status === "open"
      ? { status, resolvedBy: null, resolvedAt: null }
      : { status, resolvedBy: req.user._id, resolvedAt: new Date() });
    await report.save();
    res.status(200).json(report);
  } catch (error) {
    console.error("Review post report error:", error);
    res.status(500).json({ error: "Server error while updating the report" });
  }
};

module.exports = { reportPost, fetchPostReports, reviewPostReport };
