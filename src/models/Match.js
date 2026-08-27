const mongoose = require("mongoose");
const { MatchSchema } = require("../../schemas/MatchModel");

module.exports = mongoose.model("Match", MatchSchema);
