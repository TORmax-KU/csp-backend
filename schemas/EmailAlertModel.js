const mongoose = require("mongoose");

const EmailAlertSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  projectId: { type: mongoose.Schema.Types.ObjectId, ref: "Project", required: true },
  eventKey: { type: String, required: true },
  type: { type: String, enum: ["NewMatch", "StatusChange"], required: true },
  matchPercentage: Number,
  highBudget: Boolean,
  fromState: String,
  toState: String,
  status: { type: String, enum: ["pending", "processing", "sent", "skipped", "failed"], default: "pending" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  lease: String,
  leaseUntil: Date,
  sentAt: Date,
  errorCode: String,
}, { collection: "emailAlerts", timestamps: true });

EmailAlertSchema.index({ userId: 1, eventKey: 1 }, { unique: true });
EmailAlertSchema.index({ status: 1, nextAttemptAt: 1 });
module.exports = { EmailAlertSchema };
