const mongoose = require("mongoose");
const { NotificationSchema } = require("../../schemas/NotificationModel");

module.exports = mongoose.model("Notification", NotificationSchema);
