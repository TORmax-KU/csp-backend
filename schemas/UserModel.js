const mongoose = require("mongoose");

const UserSchema = new mongoose.Schema({
    googleId: {
        type: String,
        unique: true,
        sparse: true,
    },
    username: {
        type: String,
        unique: true,
        sparse: true,
        trim: true,
    },
    realName: {
        type: String,
        trim: true,
    },
    email: {
        type: String,
        unique: [true, "This email is already in use"],
        required: [true, "Email is required"],
        lowercase: true,
        trim: true,
    },
    aboutMe: {
        type: String,
        default: "",
    },
    role: {
        type: String,
        enum: ["Vendor", "JobLister", "Admin"],
        default: "Vendor",
    },
    status: {
        type: String,
        enum: ["Active", "Disabled"],
        default: "Active",
    },
    proficiency: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: "Skill",
        default: [],
    },
    minBudget: {
        type: Number,
        min: 0,
    },
    maxBudget: {
        type: Number,
        min: 0,
    },
    teamSize: {
        type: Number,
        min: 0,
    },
    capacity: {
        type: Number,
        min: 0,
    },
    associations: {
        type: [String],
        default: [],
    },
    companyName: {
        type: String,
        trim: true,
        default: "",
    },
    taxId: {
        type: String,
        trim: true,
        default: "",
    },
    registeredCapital: {
        type: String,
        trim: true,
        default: "",
    },
    yearsInBusiness: {
        type: Number,
        min: 0,
    },
    iso27001: {
        type: Boolean,
        default: false,
    },
    iso9001: {
        type: Boolean,
        default: false,
    },
    iso20000: {
        type: Boolean,
        default: false,
    },
    nbtcLicense: {
        type: Boolean,
        default: false,
    },
    trackedKeywords: {
        type: String,
        trim: true,
        default: "",
    },
    matchThreshold: {
        type: Number,
        min: 50,
        max: 95,
        default: 75,
    },
    dailyDigestEmail: {
        type: Boolean,
        default: true,
    },
    smsAlerts: {
        type: Boolean,
        default: false,
    },
    contactPhone: {
        type: String,
        trim: true,
        default: "",
    },
}, {
    collection: "users",
    timestamps: true,
});

module.exports = { UserSchema };
