const express = require("express");
const router = express.Router();

const {
	moderatePost,
	fetchPosts,
	fetchModerationLogs,
	fetchIngestionLogs,
	fetchIngestionHealth,
	triggerBangkokEgpIngestion,
	setUserStatus,
} = require("../../controllers/AdminController");
const { fetchPostReports, reviewPostReport } = require("../../controllers/PostReportController");
const { fetchClassificationReports, reviewClassificationReport } = require("../../controllers/ClassificationReportController");
const isAdmin = require("../middleware/isAdmin");

router.get("/posts", isAdmin, fetchPosts);
router.delete("/posts/:id", isAdmin, moderatePost);
router.get("/post-reports", isAdmin, fetchPostReports);
router.patch("/post-reports/:id", isAdmin, reviewPostReport);
router.get("/moderation-logs", isAdmin, fetchModerationLogs);
router.get("/ingestion-logs", isAdmin, fetchIngestionLogs);
router.get("/ingestion-health", isAdmin, fetchIngestionHealth);
router.get("/classification-reports", isAdmin, fetchClassificationReports);
router.patch("/classification-reports/:id", isAdmin, reviewClassificationReport);
router.post("/ingestion/egp", isAdmin, triggerBangkokEgpIngestion);
router.patch("/users/:id/status", isAdmin, setUserStatus);

module.exports = router;
