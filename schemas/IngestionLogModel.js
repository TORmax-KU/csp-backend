const mongoose = require("mongoose");

const IngestionLogSchema = new mongoose.Schema({
    source: {
        type: String,
        required: true,
        trim: true,
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
