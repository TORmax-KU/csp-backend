const mongoose = require("mongoose");

const ModerationLogSchema = new mongoose.Schema({
    adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    targetProjectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
        index: true,
    },
    targetUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    reason: {
        type: String,
        trim: true,
    },
    // The posting is deleted, so the log keeps what the admin saw.
    projectTitle: { type: String, trim: true, default: "" },
    publisherEmail: { type: String, trim: true, default: "" },
    accountDisabled: { type: Boolean, default: false },
    otherPostingsClosed: { type: Number, default: 0 },
}, {
    collection: "moderation_logs",
    timestamps: true,
});

module.exports = { ModerationLogSchema };
