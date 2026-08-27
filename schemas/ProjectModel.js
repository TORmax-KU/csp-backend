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

module.exports = { ProjectSchema };
