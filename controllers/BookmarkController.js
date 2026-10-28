const User = require("../src/models/User");
const Project = require("../src/models/Project");

const MAX_BOOKMARKS = 200;
const isObjectId = (value) => /^[a-f\d]{24}$/i.test(value);

const bookmarkIds = async (userId) => {
  const user = await User.findById(userId).select("bookmarks").lean();
  return (user?.bookmarks || []).map((id) => id.toString());
};

const fetchForUser = async (req, res) => {
  try {
    res.set("Cache-Control", "no-store");
    res.status(200).json({ ids: await bookmarkIds(req.user._id) });
  } catch (error) {
    console.error("Fetch bookmarks error:", error);
    res.status(500).json({ error: "Server error while fetching bookmarks" });
  }
};

const add = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isObjectId(projectId)) return res.status(404).json({ message: "Project not found" });

    // Only public projects can be bookmarked, matching what GET /api/projects/:id exposes.
    const project = await Project.findById(projectId).select("status").lean();
    if (!project || project.status !== "Public") return res.status(404).json({ message: "Project not found" });

    // Atomic and idempotent: skip if already saved or the list is full.
    const result = await User.updateOne(
      { _id: req.user._id, bookmarks: { $ne: project._id }, [`bookmarks.${MAX_BOOKMARKS - 1}`]: { $exists: false } },
      { $push: { bookmarks: { $each: [project._id], $position: 0 } } }
    );

    const ids = await bookmarkIds(req.user._id);
    if (result.modifiedCount === 0 && !ids.includes(projectId)) {
      return res.status(400).json({ message: `You can bookmark up to ${MAX_BOOKMARKS} projects` });
    }

    res.status(200).json({ ids });
  } catch (error) {
    console.error("Add bookmark error:", error);
    res.status(500).json({ error: "Something went wrong while adding bookmark" });
  }
};

const remove = async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!isObjectId(projectId)) return res.status(404).json({ message: "Project not found" });

    // Removal does not check the project, so bookmarks of withdrawn projects can still be cleared.
    await User.updateOne({ _id: req.user._id }, { $pull: { bookmarks: projectId } });
    res.status(200).json({ ids: await bookmarkIds(req.user._id) });
  } catch (error) {
    console.error("Remove bookmark error:", error);
    res.status(500).json({ error: "Something went wrong while removing bookmark" });
  }
};

module.exports = { fetchForUser, add, remove, MAX_BOOKMARKS };
