const Notification = require("../src/models/Notification");

const fetchForUser = async (req, res) => {
  try {
    const { read, page = 1, limit = 20 } = req.query;

    const query = { userId: req.user._id };
    if (read !== undefined) query.read = read === "true";

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .populate("projectId", "title agency status deadline")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      Notification.countDocuments(query),
      Notification.countDocuments({ userId: req.user._id, read: false }),
    ]);

    res.status(200).json({ notifications, total, unreadCount, page: Number(page), limit: Number(limit) });
  } catch (error) {
    console.error("Fetch notifications error:", error);
    res.status(500).json({ error: "Server error while fetching notifications" });
  }
};

const markRead = async (req, res) => {
  try {
    const notification = await Notification.findById(req.params.id);
    if (!notification) return res.status(404).json({ message: "Notification not found" });

    if (notification.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Forbidden" });
    }

    notification.read = true;
    await notification.save();

    res.status(200).json(notification);
  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ error: "Server error while updating notification" });
  }
};

const markAllRead = async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
    res.status(200).json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("Mark all read error:", error);
    res.status(500).json({ error: "Server error while updating notifications" });
  }
};

module.exports = { fetchForUser, markRead, markAllRead };
