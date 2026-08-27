const express = require("express");
const router = express.Router();

const { fetchForUser, markRead, markAllRead } = require("../../controllers/NotificationController");
const isAuthenticated = require("../middleware/isAuthenticated");

router.get("/", isAuthenticated, fetchForUser);
router.patch("/read-all", isAuthenticated, markAllRead);
router.patch("/:id/read", isAuthenticated, markRead);

module.exports = router;
