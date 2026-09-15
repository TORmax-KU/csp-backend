const mongoose = require("mongoose");

const SkillSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, "Skill name is required"],
        unique: [true, "This skill already exists"],
        trim: true,
        maxlength: [60, "Skill name cannot exceed 60 characters"],
    },
    normalizedName: {
        type: String,
        unique: true,
        sparse: true,
        select: false,
    },
    category: {
        type: String,
        trim: true,
        default: "General",
    },
}, {
    collection: "skills",
    timestamps: true,
});

SkillSchema.pre("validate", function setNormalizedName() {
    if (this.name) {
        this.name = this.name.trim().replace(/\s+/g, " ");
        this.normalizedName = this.name.normalize("NFKC").toLocaleLowerCase("en-US");
    }
});

module.exports = { SkillSchema };
