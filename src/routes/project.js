const express = require("express");
const router = express.Router();

const { fetch, fetchById, create, update, deleteProject } = require("../../controllers/ProjectController");
const isAuthenticated = require("../middleware/isAuthenticated");

router.get("/", fetch);
router.get("/:id", fetchById);
router.post("/", isAuthenticated, create);
router.patch("/:id", isAuthenticated, update);
router.delete("/:id", isAuthenticated, deleteProject);

module.exports = router;
