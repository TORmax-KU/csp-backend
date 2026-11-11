const mongoose = require("mongoose");
const { ClassificationReportSchema } = require("../../schemas/ClassificationReportModel");

module.exports = mongoose.model("ClassificationReport", ClassificationReportSchema);
