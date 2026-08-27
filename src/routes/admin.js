const express = require("express");
const router = express.Router();

const { moderatePost, fetchModerationLogs, fetchIngestionLogs, setUserStatus } = require("../../controllers/AdminController");
const isAdmin = require("../middleware/isAdmin");

router.delete("/posts/:id", isAdmin, moderatePost);
router.get("/moderation-logs", isAdmin, fetchModerationLogs);
router.get("/ingestion-logs", isAdmin, fetchIngestionLogs);
router.patch("/users/:id/status", isAdmin, setUserStatus);

module.exports = router;
