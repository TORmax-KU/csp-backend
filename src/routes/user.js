const express = require("express");
const router = express.Router();

const { fetch, fetchById, update, deleteUser } = require("../../controllers/UserController");
const isAuthenticated = require("../middleware/isAuthenticated");
const isAdmin = require("../middleware/isAdmin");

router.get("/", isAdmin, fetch);
router.get("/:id", isAuthenticated, (req, res, next) => {
  if (req.user.role !== "Admin" && req.user._id.toString() !== req.params.id) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}, fetchById);
router.patch("/:id", isAuthenticated, update);
router.delete("/:id", isAuthenticated, deleteUser);

module.exports = router;
