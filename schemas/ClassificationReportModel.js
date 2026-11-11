const mongoose = require("mongoose");

// Open Issue 2: users flag TORs the AI/keyword pipeline misclassified, for admins to review.
const REPORT_REASONS = ["not-it", "wrong-category", "other"];
const REPORT_STATUSES = ["open", "resolved", "dismissed"];

const ClassificationReportSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: REPORT_STATUSES, default: "open", index: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
}, {
    collection: "classification_reports",
    timestamps: true,
});

// One report per user per TOR; reporting again updates it.
ClassificationReportSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = { ClassificationReportSchema, REPORT_REASONS, REPORT_STATUSES };
