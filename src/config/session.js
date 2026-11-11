const { randomBytes } = require("node:crypto");

// NFR-07: a session ends after 2 hours without activity, then the user must sign in again.
const SESSION_IDLE_MS = 2 * 60 * 60 * 1000;
// Automatic refreshes (notification polling, auto-reloading lists) send this header so an
// open but unattended tab does not count as activity.
const BACKGROUND_HEADER = "x-background-request";
// Limits session writes to one per minute of activity.
const ACTIVITY_WRITE_MS = 60 * 1000;

function sessionSecret(env) {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required in production");
  console.warn("Using an ephemeral development session secret; configure SESSION_SECRET for persistent logins.");
  return randomBytes(32).toString("hex");
}

// `rolling` re-issues the cookie on every response, so the 2-hour window restarts with each
// request; the store's TTL matches, so an idle session is also deleted server-side.
function sessionOptions({ store, env = process.env }) {
  return {
    secret: sessionSecret(env),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store,
    cookie: {
      maxAge: SESSION_IDLE_MS,
      httpOnly: true,
      sameSite: "lax",
    },
  };
}

// Signs out a session idle for SESSION_IDLE_MS. The rolling cookie alone is not enough because
// background polling would keep extending it. Runs after express-session, before passport.session().
function idleTimeout({ idleMs = SESSION_IDLE_MS, now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const session = req.session;
    if (!session?.passport?.user) return next();
    const time = now();
    if (session.lastActiveAt !== undefined && time - session.lastActiveAt >= idleMs) {
      // A fresh, empty session: the request continues as signed out and the old one is deleted.
      return session.regenerate(next);
    }
    const background = Boolean(req.get(BACKGROUND_HEADER));
    if (session.lastActiveAt === undefined || (!background && time - session.lastActiveAt >= ACTIVITY_WRITE_MS)) {
      session.lastActiveAt = time;
    }
    next();
  };
}

module.exports = { SESSION_IDLE_MS, BACKGROUND_HEADER, sessionOptions, idleTimeout };
