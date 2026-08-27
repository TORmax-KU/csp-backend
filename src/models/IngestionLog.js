const mongoose = require("mongoose");
const { IngestionLogSchema } = require("../../schemas/IngestionLogModel");

module.exports = mongoose.model("IngestionLog", IngestionLogSchema);
