const express = require("express");
const passport = require("passport");

const router = express.Router();

router.get(
  "/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);

router.get(
  "/google/callback",
  passport.authenticate("google", {
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed`,
  }),
  (req, res) => {
    res.redirect(process.env.FRONTEND_URL);
  }
);

router.get("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    res.redirect(process.env.FRONTEND_URL);
  });
});

router.get("/me", (req, res) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  res.json(req.user);
});

module.exports = router;
