const mongoose = require("mongoose");
const { PostReportSchema } = require("../../schemas/PostReportModel");

module.exports = mongoose.model("PostReport", PostReportSchema);
