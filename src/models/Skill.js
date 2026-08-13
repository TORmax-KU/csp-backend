const mongoose = require("mongoose");
const { SkillSchema } = require("../../schemas/SkillModel");

module.exports = mongoose.model("Skill", SkillSchema);
