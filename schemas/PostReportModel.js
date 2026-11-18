const mongoose = require("mongoose");

// UC5: users flag direct job postings that break platform policy, for admins to review.
const POST_REPORT_REASONS = ["spam", "fraud", "not-it", "offensive", "other"];
const POST_REPORT_STATUSES = ["open", "resolved", "dismissed"];

const PostReportSchema = new mongoose.Schema({
    projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true, index: true },
    // Kept so the admin queue still reads sensibly after the posting is removed.
    projectTitle: { type: String, trim: true, default: "" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    reason: { type: String, enum: POST_REPORT_REASONS, required: true },
    note: { type: String, trim: true, maxlength: 500, default: "" },
    status: { type: String, enum: POST_REPORT_STATUSES, default: "open", index: true },
    // "removed" when an admin took the posting down; "" otherwise.
    outcome: { type: String, enum: ["", "removed"], default: "" },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    resolvedAt: { type: Date, default: null },
}, {
    collection: "post_reports",
    timestamps: true,
});

// One report per user per posting; reporting again updates it.
PostReportSchema.index({ projectId: 1, userId: 1 }, { unique: true });

module.exports = { PostReportSchema, POST_REPORT_REASONS, POST_REPORT_STATUSES };
