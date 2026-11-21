// Creates the first administrator, or promotes an existing account. Admin accounts are never
// self-service (registration only offers Vendor and Job Lister), so this is the only way in.
//
// Usage:
//   node scripts/create-admin.js --email admin@example.com
//     Promotes an existing account (email/password or Google) to Admin and re-activates it.
//   ADMIN_PASSWORD='…' node scripts/create-admin.js --email admin@example.com --create
//     Creates a new email/password Admin account when none exists for that email.
//   Docker: docker compose exec -e ADMIN_PASSWORD='…' -T backend node scripts/create-admin.js --email … --create
//
// The password is read from ADMIN_PASSWORD so it never appears in the process list or shell history.
require("dotenv").config({ quiet: true });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../src/models/User");

const MAX_EMAIL_LENGTH = 254; // RFC 5321; also bounds input to the regex to avoid ReDoS
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = value => typeof value === "string" && value.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(value);

function parseArgs(argv) {
  const args = { create: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--create") args.create = true;
    else if (argv[i] === "--email") args.email = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

(async () => {
  const { email: rawEmail, create } = parseArgs(process.argv.slice(2));
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!isValidEmail(email)) throw new Error("Pass a valid --email");

  await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/fullstack_db");
  const existing = await User.findOne({ email });

  if (existing) {
    // Bumping sessionVersion signs out any session that still carries the old role.
    await User.updateOne({ _id: existing._id }, { $set: { role: "Admin", status: "Active" }, $inc: { sessionVersion: 1 } });
    console.log(`${email} is now an Admin${existing.role === "Admin" ? " (already was)" : ` (was ${existing.role})`}. Sign in again to use the admin console.`);
  } else if (create) {
    const password = process.env.ADMIN_PASSWORD;
    // Same rules as registration (AuthController): 8+ characters, at most 72 bytes for bcrypt.
    if (typeof password !== "string" || password.length < 8) throw new Error("Set ADMIN_PASSWORD to at least 8 characters");
    if (Buffer.byteLength(password, "utf8") > 72) throw new Error("ADMIN_PASSWORD cannot exceed 72 bytes");
    await User.create({ email, passwordHash: await bcrypt.hash(password, 12), role: "Admin", realName: "Administrator" });
    console.log(`Created Admin account ${email}. Sign in at /login with that email and password.`);
  } else {
    throw new Error(`No account for ${email}. Register it first, or add --create with ADMIN_PASSWORD set.`);
  }
  await mongoose.disconnect();
})().catch(async error => {
  console.error(error.message);
  process.exitCode = 1;
  await mongoose.disconnect().catch(() => {});
});
