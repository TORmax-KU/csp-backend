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
    // Keep the event key after dismissal so a background sweep cannot recreate it.
    deleted: { type: Boolean, default: false },
    // NewMatch only
    matchPercentage: Number,
    highBudget: { type: Boolean, default: false },
    // Persistent deduplication, including concurrent sweeps and process restarts.
    eventKey: String,
    // StatusChange only: project state before and after (e.g. "open" -> "cancelled")
    fromState: String,
    toState: String,
}, {
    collection: "notifications",
    timestamps: true,
});

NotificationSchema.index({ userId: 1, createdAt: -1 });
NotificationSchema.index({ userId: 1, eventKey: 1 }, {
    unique: true, partialFilterExpression: { eventKey: { $type: "string" } },
});

module.exports = { NotificationSchema };
