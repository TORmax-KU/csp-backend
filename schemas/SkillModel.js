const mongoose = require("mongoose");

const SkillSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Skill name is required"],
        unique: [true, "This skill already exists"],
        trim: true,
    },
    category: {
        type: String,
        trim: true,
    },
}, {
    collection: "skills",
    timestamps: true,
});

module.exports = { SkillSchema };
