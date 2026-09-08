const mongoose = require("mongoose");

const ProjectSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, "Title is required"],
        trim: true,
    },
    agency: {
        type: String,
        trim: true,
    },
    description: {
        type: String,
        default: "",
    },
    budget: {
        type: Number,
        min: 0,
    },
    category: {
        type: String,
        trim: true,
    },
    requiredSkills: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "Skill",
        default: [],
    },
    status: {
        type: String,
        enum: ["Draft", "Public"],
        default: "Public",
    },
    priceFlag: {
        type: String,
        enum: ["Normal", "Underpriced", "Overpriced", "ScopeMismatch"],
        default: "Normal",
    },
    sourceUrl: {
        type: String,
        trim: true,
    },
    source: {
        type: String,
        trim: true,
    },
    externalId: {
        type: String,
        trim: true,
    },
    sourceStatus: {
        type: String,
        trim: true,
    },
    classification: {
        type: String,
        enum: ["software", "non-software", "unclassified"],
        default: "unclassified",
    },
    classificationMethod: {
        type: String,
        trim: true,
    },
    matchedKeywords: {
        type: [String],
        default: [],
    },
    lastScrapedAt: {
        type: Date,
    },
    rawData: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    publisherId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
    },
    deadline: {
        type: Date,
    },
}, {
    collection: "projects",
    timestamps: true,
});

ProjectSchema.index(
    { source: 1, externalId: 1 },
    { unique: true, sparse: true }
);

module.exports = { ProjectSchema };
