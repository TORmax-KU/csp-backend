const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
    },
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Project",
        required: true,
    },
    type: {
        type: String,
        enum: ["NewMatch", "StatusChange"],
        required: true,
    },
    read: {
        type: Boolean,
        default: false,
    },
    // NewMatch only
    matchPercentage: Number,
    // StatusChange only: project state before and after (e.g. "open" -> "cancelled")
    fromState: String,
    toState: String,
}, {
    collection: "notifications",
    timestamps: true,
});

NotificationSchema.index({ userId: 1, createdAt: -1 });

module.exports = { NotificationSchema };
