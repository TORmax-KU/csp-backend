const mongoose = require("mongoose");

const IngestionLogSchema = new mongoose.Schema({
    source: {
        type: String,
        required: true,
        trim: true,
    },
    sourceUrl: {
        type: String,
        trim: true,
    },
    budgetYear: {
        type: Number,
    },
    status: {
        type: String,
        enum: ["Success", "Failed"],
        required: true,
    },
    torsIngested: {
        type: Number,
        default: 0,
    },
    projectsCreated: {
        type: Number,
        default: 0,
    },
    projectsUpdated: {
        type: Number,
        default: 0,
    },
    projectsSkipped: {
        type: Number,
        default: 0,
    },
    projectsFiltered: {
        type: Number,
        default: 0,
    },
    projectsFailed: {
        type: Number,
        default: 0,
    },
    durationMs: {
        type: Number,
    },
    filterVersion: {
        type: String,
        default: "software-keywords-v1",
    },
    filterUsed: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    aiTokensUsed: {
        type: Number,
        default: 0,
    },
    errorMessage: {
        type: String,
        default: "",
    },
    startedAt: {
        type: Date,
        required: true,
    },
    finishedAt: {
        type: Date,
    },
}, {
    collection: "ingestion_logs",
    timestamps: true,
});

module.exports = { IngestionLogSchema };
