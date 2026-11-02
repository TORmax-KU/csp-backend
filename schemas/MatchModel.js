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
    matchPercentage: {
        type: Number,
        min: 0,
        max: 100,
    },
    matchedSkillIds: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "Skill",
        default: [],
    },
    // Last project state the vendor was told about; a different current state triggers a StatusChange.
    notifiedState: {
        type: String,
        default: null,
    },
}, {
    collection: "matches",
    timestamps: true,
});

MatchSchema.index({ userId: 1, projectId: 1 }, { unique: true });

module.exports = { MatchSchema };
