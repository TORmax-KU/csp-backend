const express = require("express");
const router = express.Router();

const { fetch, fetchById, update, deleteUser } = require("../../controllers/UserController");
const isAuthenticated = require("../middleware/isAuthenticated");

router.get("/", fetch);
router.get("/:id", fetchById);
router.patch("/:id", isAuthenticated, update);
router.delete("/:id", isAuthenticated, deleteUser);

module.exports = router;
