const express = require("express");
const router = express.Router();

const { fetch, create, deleteSkill } = require("../../controllers/SkillController");
const isAuthenticated = require("../middleware/isAuthenticated");

router.get("/", fetch);
router.post("/", isAuthenticated, create);
router.delete("/:id", isAuthenticated, deleteSkill);

module.exports = router;
