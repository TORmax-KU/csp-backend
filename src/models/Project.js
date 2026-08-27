const mongoose = require("mongoose");
const { ProjectSchema } = require("../../schemas/ProjectModel");

module.exports = mongoose.model("Project", ProjectSchema);
