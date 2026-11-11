const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const User = require("../models/User");

passport.serializeUser((user, done) => {
  done(null, { id: user.id, sessionVersion: user.sessionVersion ?? 0 });
});

passport.deserializeUser(async (identity, done) => {
  try {
    // Sessions created before versioning contain just the user ID.
    const id = typeof identity === "string" ? identity : identity.id;
    const version = typeof identity === "string" ? 0 : identity.sessionVersion;
    const user = await User.findById(id);
    if (!user || user.status === "Disabled" || (user.sessionVersion ?? 0) !== version) {
      return done(null, false);
    }
    done(null, user);
  } catch (error) {
    done(error);
  }
});

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        let user = await User.findOne({ googleId: profile.id });
        const email = profile.emails[0];

        // Link Google to an existing email/password account only when Google has verified the address.
        if (!user && email.verified !== false) {
          user = await User.findOneAndUpdate(
            { email: email.value.toLowerCase(), googleId: { $exists: false } },
            { googleId: profile.id },
            { new: true }
          );
        }

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            email: profile.emails[0].value,
            realName: profile.displayName,
          });
        }

        if (user.status === "Disabled") return done(null, false);
        done(null, user);
      } catch (error) {
        done(error);
      }
    }
  )
);

module.exports = passport;
