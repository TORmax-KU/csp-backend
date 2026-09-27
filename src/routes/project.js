const express = require("express");
const router = express.Router();

const { fetch, fetchById, create, update, deleteProject } = require("../../controllers/ProjectController");
const isAuthenticated = require("../middleware/isAuthenticated");
const { queueAnalysis, matchSkills } = require("../../controllers/TorAnalysisController");

router.get("/", fetch);
router.get("/:id", fetchById);
router.get("/:id/match", isAuthenticated, matchSkills);
router.post("/:id/analyze", isAuthenticated, queueAnalysis);
router.post("/", isAuthenticated, create);
router.patch("/:id", isAuthenticated, update);
router.delete("/:id", isAuthenticated, deleteProject);

module.exports = router;
