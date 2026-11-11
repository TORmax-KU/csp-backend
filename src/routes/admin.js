const express = require("express");
const router = express.Router();

const {
	moderatePost,
	fetchModerationLogs,
	fetchIngestionLogs,
	fetchIngestionHealth,
	triggerBangkokEgpIngestion,
	setUserStatus,
} = require("../../controllers/AdminController");
const { fetchClassificationReports, reviewClassificationReport } = require("../../controllers/ClassificationReportController");
const isAdmin = require("../middleware/isAdmin");

router.delete("/posts/:id", isAdmin, moderatePost);
router.get("/moderation-logs", isAdmin, fetchModerationLogs);
router.get("/ingestion-logs", isAdmin, fetchIngestionLogs);
router.get("/ingestion-health", isAdmin, fetchIngestionHealth);
router.get("/classification-reports", isAdmin, fetchClassificationReports);
router.patch("/classification-reports/:id", isAdmin, reviewClassificationReport);
router.post("/ingestion/egp", isAdmin, triggerBangkokEgpIngestion);
router.patch("/users/:id/status", isAdmin, setUserStatus);

module.exports = router;
