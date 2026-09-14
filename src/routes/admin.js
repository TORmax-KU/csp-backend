const express = require("express");
const router = express.Router();

const {
	moderatePost,
	fetchModerationLogs,
	fetchIngestionLogs,
	triggerBangkokEgpIngestion,
	setUserStatus,
} = require("../../controllers/AdminController");
const isAdmin = require("../middleware/isAdmin");

router.delete("/posts/:id", isAdmin, moderatePost);
router.get("/moderation-logs", isAdmin, fetchModerationLogs);
router.get("/ingestion-logs", isAdmin, fetchIngestionLogs);
router.post("/ingestion/egp", isAdmin, triggerBangkokEgpIngestion);
router.patch("/users/:id/status", isAdmin, setUserStatus);

module.exports = router;
