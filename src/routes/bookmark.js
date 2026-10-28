const express = require("express");
const router = express.Router();

const { fetchForUser, add, remove } = require("../../controllers/BookmarkController");
const isAuthenticated = require("../middleware/isAuthenticated");

// Bookmarks always belong to the signed-in user; there is no user id in the path to spoof.
router.get("/", isAuthenticated, fetchForUser);
router.put("/:projectId", isAuthenticated, add);
router.delete("/:projectId", isAuthenticated, remove);

module.exports = router;
