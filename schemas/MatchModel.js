const mongoose = require("mongoose");

const MatchSchema = new mongoose.Schema({
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
}, {
    collection: "matches",
    timestamps: true,
});

MatchSchema.index({ userId: 1, projectId: 1 }, { unique: true });

module.exports = { MatchSchema };
