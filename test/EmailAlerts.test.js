const test = require("node:test");
const assert = require("node:assert/strict");
const nodemailer = require("nodemailer");
const { SMTPServer } = require("smtp-server");
const { smtpOptions, processEmailAlert } = require("../src/services/EmailAlerts");
const { alertChannels } = require("../src/services/NotificationDelivery");
const { UserSchema } = require("../schemas/UserModel");
const mongoose = require("mongoose");
const { spawnSync } = require("node:child_process");

test("missing optional mail package cannot crash module loading or disabled/enabled worker startup", () => {
  const result = spawnSync(process.execPath, ["-e", `
    const assert = require('node:assert/strict');
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(name, ...args) {
      if (name === 'nodemailer') throw Object.assign(new Error('Missing optional dependency'), { code: 'MODULE_NOT_FOUND' });
      return originalLoad.call(this, name, ...args);
    };
    const { startEmailAlertWorker } = require('./src/services/EmailAlerts');
    const errors = [];
    const log = { error: message => errors.push(message) };
    assert.equal(startEmailAlertWorker({ env: {}, log }), undefined);
    assert.equal(errors.length, 0);
    assert.equal(startEmailAlertWorker({ env: { EMAIL_ALERTS_ENABLED: 'true', SMTP_HOST: 'smtp.example.test', EMAIL_FROM: 'alerts@example.test' }, log }), undefined);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Other features remain available/);
  `], { cwd: require('node:path').resolve(__dirname, '..'), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("all 16 preference combinations route independently; legacy email/SMS values never opt in", () => {
  for (let mask = 0; mask < 16; mask++) {
    const user = { notifyMatchesInApp: Boolean(mask & 1), notifyMatchesEmail: Boolean(mask & 2),
      notifyHighBudgetInApp: Boolean(mask & 4), notifyHighBudgetEmail: Boolean(mask & 8) };
    for (const budget of [9_000_000, 10_000_000, 10_000_001]) {
      const channels = alertChannels(user, { budget });
      assert.equal(channels.inApp, Boolean(mask & 1) || (budget > 10_000_000 && Boolean(mask & 4)));
      assert.equal(channels.email, Boolean(mask & 2) || (budget > 10_000_000 && Boolean(mask & 8)));
    }
  }
  assert.equal(alertChannels({ dailyDigestEmail: true, smsAlerts: true }, { budget: 20_000_000 }).email, false);
  const User = mongoose.models.AlertPreferencesUser || mongoose.model("AlertPreferencesUser", UserSchema);
  const user = new User({ email: "vendor@example.test" });
  assert.equal(user.notifyMatchesInApp, true);
  assert.equal(user.notifyMatchesEmail, false);
  assert.equal(user.notifyHighBudgetInApp, false);
  assert.equal(user.notifyHighBudgetEmail, false);
});

test("email is off by default and production requires TLS even if local bypass is set", () => {
  assert.equal(smtpOptions({}), null);
  assert.throws(() => smtpOptions({ EMAIL_ALERTS_ENABLED: "true" }));
  const base = { EMAIL_ALERTS_ENABLED: "true", SMTP_HOST: "127.0.0.1", EMAIL_FROM: "alerts@example.test",
    SMTP_ALLOW_INSECURE_LOCAL: "true" };
  assert.equal(smtpOptions({ ...base, NODE_ENV: "production" }).requireTLS, true);
  assert.equal(smtpOptions(base).requireTLS, false);
  assert.throws(() => smtpOptions({ ...base, SMTP_USER: "user" }));
});

const now = new Date("2026-11-16T08:00:00Z");
function fixture() {
  const alert = { _id: "a1", userId: "u1", projectId: "p1", eventKey: "match:m1", type: "NewMatch",
    attempts: 0, status: "pending", nextAttemptAt: now };
  const user = { _id: "u1", email: "vendor@example.test", status: "Active", role: "Vendor",
    proficiency: ["react"], matchThreshold: 50, notifyMatchesEmail: true };
  const project = { _id: "p1", source: "direct", title: "Example IT project", budget: 12_000_000,
    status: "Public", procurementStatus: "open", requiredSkills: ["react"], analysisStatus: "skipped",
    deadline: new Date("2026-12-01T00:00:00Z") };
  const deps = {
    now,
    users: { findById: () => ({ lean: async () => user }) },
    projects: { findById: () => ({ lean: async () => project }) },
    skills: { find: () => ({ select: () => ({ lean: async () => [] }) }) },
    alerts: {
      findOneAndUpdate: async (filter, update) => {
        if (alert.status !== "pending" || alert.nextAttemptAt > now) return null;
        Object.assign(alert, update.$set);
        alert.attempts += update.$inc.attempts;
        return alert;
      },
      updateOne: async (filter, update) => {
        assert.equal(filter.lease, alert.lease);
        Object.assign(alert, update.$set);
        for (const key of Object.keys(update.$unset || {})) delete alert[key];
      },
    },
  };
  return { alert, user, project, deps };
}

test("email worker uses real SMTP, records acceptance, retries 450 and stops on 550", async () => {
  let rejectCode;
  const messages = [];
  const server = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], logger: false,
    onRcptTo(address, session, callback) {
      callback(rejectCode ? Object.assign(new Error("Controlled test rejection"), { responseCode: rejectCode }) : null);
    },
    onData(stream, session, callback) {
      let body = "";
      stream.on("data", chunk => { body += chunk; });
      stream.on("end", () => { messages.push(body); callback(); });
    },
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const env = { EMAIL_ALERTS_ENABLED: "true", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(server.server.address().port),
    SMTP_ALLOW_INSECURE_LOCAL: "true", EMAIL_FROM: "TORmax <alerts@example.test>", FRONTEND_URL: "https://tormax.example.test" };
  const transport = nodemailer.createTransport(smtpOptions(env));
  try {
    const success = fixture();
    assert.equal(await processEmailAlert({ ...success.deps, env, transport }), true);
    assert.equal(success.alert.status, "sent");
    assert.equal(messages.length, 1);
    assert.match(messages[0], /https:\/\/tormax.example.test\/tor-page\/p1/);
    assert.match(messages[0], /https:\/\/tormax.example.test\/profile/);
    assert.equal(await processEmailAlert({ ...success.deps, env, transport }), false);

    rejectCode = 450;
    const temporary = fixture();
    await processEmailAlert({ ...temporary.deps, env, transport });
    assert.equal(temporary.alert.status, "pending");
    assert.ok(temporary.alert.nextAttemptAt > now);
    assert.equal(await processEmailAlert({ ...temporary.deps, env, transport }), false);
    temporary.alert.nextAttemptAt = now;
    rejectCode = undefined;
    await processEmailAlert({ ...temporary.deps, env, transport });
    assert.equal(temporary.alert.status, "sent");

    rejectCode = 550;
    const permanent = fixture();
    await processEmailAlert({ ...permanent.deps, env, transport });
    assert.equal(permanent.alert.status, "failed");
    rejectCode = 450;
    const exhausted = fixture();
    exhausted.alert.attempts = 4;
    await processEmailAlert({ ...exhausted.deps, env, transport });
    assert.equal(exhausted.alert.status, "failed");
    assert.equal(messages.length, 2);
  } finally {
    transport.close();
    await new Promise(resolve => server.close(resolve));
  }
});

test("queued mail rechecks opt-out, disabled accounts, skill/budget changes and project expiry before sending", async () => {
  for (const change of [
    f => { f.user.notifyMatchesEmail = false; },
    f => { f.user.status = "Disabled"; },
    f => { f.user.proficiency = []; },
    f => { f.user.maxBudget = 5_000_000; },
    f => { f.project.deadline = new Date("2026-11-01"); },
  ]) {
    const f = fixture();
    change(f);
    await processEmailAlert({ ...f.deps, transport: { sendMail: () => assert.fail("must not send") } });
    assert.equal(f.alert.status, "skipped");
  }
});
