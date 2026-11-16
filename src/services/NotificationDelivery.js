const Notification = require("../models/Notification");
const EmailAlert = require("../models/EmailAlert");

const HIGH_BUDGET = 10_000_000;
const ALERT_FIELDS = ["notifyMatchesInApp", "notifyMatchesEmail", "notifyHighBudgetInApp", "notifyHighBudgetEmail"];

// Caller supplies a matching project. Budget alerts are a subset of matches.
function alertChannels(user, project) {
  const highBudget = Number.isFinite(project.budget) && project.budget > HIGH_BUDGET;
  return {
    inApp: (user.notifyMatchesInApp ?? true) || (highBudget && user.notifyHighBudgetInApp === true),
    email: user.notifyMatchesEmail === true || (highBudget && user.notifyHighBudgetEmail === true),
    highBudget,
  };
}

async function insertOnce(model, doc) {
  try {
    return await model.updateOne({ userId: doc.userId, eventKey: doc.eventKey }, { $setOnInsert: doc }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

async function dispatchNotification({ user, project, eventKey, type, matchPercentage, fromState, toState },
  { notifications = Notification, emailAlerts = EmailAlert } = {}) {
  const channels = alertChannels(user, project);
  const doc = { userId: user._id, projectId: project._id, eventKey, type,
    highBudget: channels.highBudget,
    ...(matchPercentage != null ? { matchPercentage } : {}),
    ...(fromState ? { fromState, toState } : {}) };
  if (channels.inApp) await insertOnce(notifications, doc);
  if (channels.email) await insertOnce(emailAlerts, doc);
}

module.exports = { HIGH_BUDGET, ALERT_FIELDS, alertChannels, dispatchNotification };
