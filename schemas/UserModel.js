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
}, {
    collection: "users",
    timestamps: true,
});

module.exports = { UserSchema };
