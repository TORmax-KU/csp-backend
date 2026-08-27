const mongoose = require("mongoose");
const { ModerationLogSchema } = require("../../schemas/ModerationLogModel");

module.exports = mongoose.model("ModerationLog", ModerationLogSchema);
