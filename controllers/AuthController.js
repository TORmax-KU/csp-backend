const bcrypt = require("bcryptjs");
const User = require("../src/models/User");

const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt ignores input past 72 bytes, so longer passwords would be silently truncated.
const MAX_PASSWORD_BYTES = 72;
const SELF_SERVICE_ROLES = ["Vendor", "JobLister"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Compared against when no account exists so unknown emails take as long as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync("tormax-timing-equalizer", BCRYPT_ROUNDS);

const publicUser = (user) => {
  const data = user.toObject();
  delete data.passwordHash;
  return data;
};

const normalizeEmail = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const validatePassword = (password) => {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return `Password cannot exceed ${MAX_PASSWORD_BYTES} bytes`;
  }
  return null;
};

const logIn = (req, user) =>
  new Promise((resolve, reject) => req.login(user, (error) => (error ? reject(error) : resolve())));

// FR-01: register with local email/password credentials
const register = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;
    const realName = typeof req.body.realName === "string" ? req.body.realName.trim() : "";
    const role = req.body.role === undefined ? "Vendor" : req.body.role;

    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: "A valid email is required" });
    }
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });
    // Admin accounts are never self-service.
    if (!SELF_SERVICE_ROLES.includes(role)) {
      return res.status(400).json({ message: "Role must be Vendor or JobLister" });
    }

    if (await User.exists({ email })) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const user = await User.create({ email, passwordHash, realName, role });

    await logIn(req, user);
    res.status(201).json(publicUser(user));
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }
    console.error("Register error:", error);
    res.status(500).json({ error: "Server error while registering" });
  }
};

// FR-01: authenticate with local email/password credentials
const login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!email || typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email }).select("+passwordHash");
    const matches = await bcrypt.compare(password, user?.passwordHash || DUMMY_HASH);

    // Same response for unknown email, Google-only account and wrong password.
    if (!user?.passwordHash || !matches) {
      return res.status(401).json({ message: "Invalid email or password" });
    }
    if (user.status === "Disabled") {
      return res.status(403).json({ message: "This account has been disabled" });
    }

    await logIn(req, user);
    res.status(200).json(publicUser(user));
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error while logging in" });
  }
};

module.exports = { register, login };
