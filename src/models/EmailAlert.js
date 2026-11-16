const mongoose = require("mongoose");
const { EmailAlertSchema } = require("../../schemas/EmailAlertModel");
module.exports = mongoose.model("EmailAlert", EmailAlertSchema);
