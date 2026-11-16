const { randomUUID, createHash } = require("node:crypto");
const EmailAlert = require("../models/EmailAlert");
const User = require("../models/User");
const Project = require("../models/Project");
const Skill = require("../models/Skill");
const { alertChannels } = require("./NotificationDelivery");
const { availability } = require("./ProcurementAvailability");

function smtpOptions(env = process.env) {
  if (env.EMAIL_ALERTS_ENABLED !== "true") return null;
  const port = Number(env.SMTP_PORT || 587);
  if (!env.SMTP_HOST || !env.EMAIL_FROM || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("Configure SMTP_HOST, SMTP_PORT and EMAIL_FROM before enabling email alerts");
  }
  if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD)) throw new Error("Configure both SMTP_USER and SMTP_PASSWORD");
  const secure = env.SMTP_SECURE === "true";
  return {
    host: env.SMTP_HOST, port, secure,
    // Plain SMTP is allowed only for an explicitly configured local development server.
    requireTLS: !secure && !(env.NODE_ENV !== "production" && env.SMTP_ALLOW_INSECURE_LOCAL === "true"
      && ["localhost", "127.0.0.1", "::1"].includes(env.SMTP_HOST)),
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}

function emailMessage(alert, user, project, env = process.env) {
  const base = new URL(env.FRONTEND_URL || "http://localhost:3000");
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("FRONTEND_URL must use HTTP or HTTPS");
  const projectUrl = new URL(`/tor-page/${project._id}`, base).href;
  const preferencesUrl = new URL("/profile", base).href;
  const high = project.budget > 10_000_000;
  const subject = alert.type === "StatusChange" ? "TORmax: matched project status changed"
    : high ? "TORmax: matching project over THB 10 million" : "TORmax: new matching project";
  const lines = [project.title || "Matching TOR", project.agency || "",
    `Budget: THB ${Number(project.budget || 0).toLocaleString("en-US")}`];
  if (alert.matchPercentage != null) lines.push(`Skill match: ${alert.matchPercentage}%`);
  if (alert.type === "StatusChange") lines.push(`Status: ${alert.fromState} -> ${alert.toState}`);
  lines.push("", `View project: ${projectUrl}`, "", `Manage or turn off email alerts: ${preferencesUrl}`);
  return {
    from: env.EMAIL_FROM, to: user.email, subject, text: lines.filter(line => line !== undefined).join("\n"),
    // Stable across retry attempts. SMTP is at-least-once: a crash after acceptance
    // but before recording sentAt can still cause a repeated delivery.
    messageId: `<${createHash("sha256").update(`${user._id}:${alert.eventKey}`).digest("hex")}@tormax.alerts>`,
  };
}

async function processEmailAlert({ alerts = EmailAlert, users = User, projects = Project, skills = Skill,
  transport, env = process.env, now = new Date() } = {}) {
  const lease = randomUUID();
  const alert = await alerts.findOneAndUpdate({ $or: [
    { status: "pending", nextAttemptAt: { $lte: now } },
    { status: "processing", leaseUntil: { $lt: now } },
  ] }, { $set: { status: "processing", lease, leaseUntil: new Date(now.getTime() + 5 * 60_000) },
    $inc: { attempts: 1 } }, { new: true, sort: { nextAttemptAt: 1, _id: 1 } });
  if (!alert) return false;
  const filter = { _id: alert._id, lease };
  const finish = set => alerts.updateOne(filter, { $set: set, $unset: { lease: 1, leaseUntil: 1 } });
  try {
    const [user, project, catalog] = await Promise.all([
      users.findById(alert.userId).lean(), projects.findById(alert.projectId).lean(), skills.find({}).select("name").lean(),
    ]);
    const matching = user && project && require("./MatchingEngine").scoreProject(project, user, catalog);
    const state = project && require("./MatchingEngine").trackedState(project, now);
    if (!user || user.status !== "Active" || user.role !== "Vendor" || !user.email || !project || project.status !== "Public"
      || !alertChannels(user, project).email || !matching
      || (alert.type === "NewMatch" ? availability(project, now) !== "open" : state !== alert.toState)) {
      await finish({ status: "skipped", errorCode: "NO_LONGER_ELIGIBLE" });
      return true;
    }
    const result = await transport.sendMail(emailMessage({ type: alert.type, eventKey: alert.eventKey,
      fromState: alert.fromState, toState: alert.toState, matchPercentage: matching.matchPercentage }, user, project, env));
    if (!result.accepted?.length) throw Object.assign(new Error("Recipient was not accepted"), { code: "EENVELOPE", responseCode: 550 });
    await finish({ status: "sent", sentAt: now, errorCode: "" });
  } catch (error) {
    const responseCode = Number(error.responseCode);
    const permanent = responseCode >= 500 || (!(responseCode >= 400 && responseCode < 500)
      && ["EAUTH", "EENVELOPE", "EMESSAGE"].includes(error.code));
    const retry = !permanent && alert.attempts < 5;
    await finish({ status: retry ? "pending" : "failed", errorCode: String(error.code || "EMAIL_DELIVERY_FAILED").slice(0, 80),
      nextAttemptAt: new Date(now.getTime() + 60_000 * Math.min(30, 2 ** Math.min(alert.attempts, 5))) });
  }
  return true;
}

function startEmailAlertWorker({ env = process.env, log = console } = {}) {
  let options;
  try { options = smtpOptions(env); } catch (error) { log.error(error.message); return; }
  if (!options) return;
  let transport;
  try {
    // Optional email dependencies must never prevent authentication or browsing
    // from starting, including development containers with an older dependency volume.
    transport = require("nodemailer").createTransport(options);
  } catch {
    log.error("Email alerts unavailable: install backend dependencies and check SMTP configuration. Other features remain available.");
    return;
  }
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      // Bounded batches; email never blocks ingestion or the profile response.
      for (let n = 0; n < 10; n++) if (!await processEmailAlert({ transport, env })) break;
    } catch { log.error("Email alert worker failed; pending alerts will be retried"); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 30_000);
  timer.unref();
  void tick();
  return timer;
}

module.exports = { smtpOptions, emailMessage, processEmailAlert, startEmailAlertWorker };
