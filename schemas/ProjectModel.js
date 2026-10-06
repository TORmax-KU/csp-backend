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
    descriptions: { type: String, default: "" },
    analysisStatus: { type: String, enum: ["pending", "processing", "completed", "failed", "awaiting_documents", "needs_review", "retry_pending"], default: "pending", index: true },
    analysisAttempts: { type: Number, default: 0 },
    analysisRetryCount: { type: Number, default: 0 },
    nextAnalysisAt: Date,
    analysisErrorCode: { type: String, default: "" },
    analysisLease: String,
    analysisLeaseUntil: Date,
    analysisError: { type: String, default: "" },
    analyzedAt: Date,
    aiModel: String,
    aiPromptVersion: String,
    aiAnalysis: {
        mandatorySkillNames: [String],
        unmappedSkillNames: [String],
        documentUrls: [String],
        noMandatorySkillsReason: String,
        skillEvidence: [{
            _id: false,
            name: String,
            quote: String,
            page: Number,
            documentIndex: Number,
        }],
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
    announcedAt: Date,
    procurementStartAt: Date,
    submissionStartAt: Date,
    documentSaleEndAt: Date,
    deadlinePrecision: { type: String, enum: ["datetime", "date", "unknown"], default: "unknown" },
    procurementMethod: String,
    referencePrice: Number,
    procurementStatus: { type: String, enum: ["open", "unknown", "closed", "awarded", "cancelled", "draft"], default: "unknown", index: true },
    sourceVerifiedAt: Date,
    dataVerified: { type: Boolean, default: false },
    documents: [{ _id: false, title: String, url: String, kind: { type: String, enum: ["tor", "announcement", "other"] }, verifiedAt: Date }],
    qualifications: [String],
    deliverables: [String],
    sourceSkillNames: [String],
    contact: { name: String, phone: String, email: String, address: String },
    submissionLocation: String,
}, {
    collection: "projects",
    timestamps: true,
});

ProjectSchema.index({ status: 1, dataVerified: 1, procurementStatus: 1, deadline: 1 });

ProjectSchema.index(
    { source: 1, externalId: 1 },
    { unique: true, sparse: true }
);

module.exports = { ProjectSchema };
