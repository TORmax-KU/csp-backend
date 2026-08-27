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
}, {
    collection: "moderation_logs",
    timestamps: true,
});

module.exports = { ModerationLogSchema };
