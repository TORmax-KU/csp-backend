const express = require("express");
const router = express.Router();

const { fetchForUser } = require("../../controllers/MatchController");
const isAuthenticated = require("../middleware/isAuthenticated");

// Matches always belong to the signed-in user; there is no user id in the path to spoof.
router.get("/", isAuthenticated, fetchForUser);

module.exports = router;
