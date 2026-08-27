const mongoose = require("mongoose");
const User = require("../src/models/User");
const Project = require("../src/models/Project");
const ModerationLog = require("../src/models/ModerationLog");
const IngestionLog = require("../src/models/IngestionLog");
const Notification = require("../src/models/Notification");
const Match = require("../src/models/Match");

// FR-14 / Use Case 5: remove a violating post and auto-disable the publisher
const moderatePost = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const project = await Project.findById(id).session(session);
    if (!project) {
      await session.abortTransaction();
      return res.status(404).json({ message: "Project not found" });
    }

    const publisherId = project.publisherId;

    // archive the project rather than hard-delete so the log remains meaningful
    await Project.findByIdAndDelete(id, { session });

    if (publisherId) {
      await User.findByIdAndUpdate(publisherId, { status: "Disabled" }, { session });

      // invalidate all sessions for the publisher via the session store collection
      await mongoose.connection.db
        .collection("sessions")
        .deleteMany({ "session.passport.user": publisherId.toString() });
    }

    await ModerationLog.create(
      [
        {
          adminId: req.user._id,
          targetProjectId: id,
          targetUserId: publisherId,
          reason: reason || "",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(200).json({ message: "Post removed and publisher account disabled" });
  } catch (error) {
    await session.abortTransaction();
    console.error("Moderate post error:", error);
    res.status(500).json({ error: "Server error while moderating post" });
  } finally {
    session.endSession();
  }
};

const fetchModerationLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const [logs, total] = await Promise.all([
      ModerationLog.find()
        .populate("adminId", "username email")
        .populate("targetProjectId", "title")
        .populate("targetUserId", "username email")
        .sort({ createdAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      ModerationLog.countDocuments(),
    ]);

    res.status(200).json({ logs, total });
  } catch (error) {
    console.error("Fetch moderation logs error:", error);
    res.status(500).json({ error: "Server error while fetching moderation logs" });
  }
};

// Use Case 6: monitor ingestion pipeline health
const fetchIngestionLogs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = status ? { status } : {};

    const [logs, total] = await Promise.all([
      IngestionLog.find(query)
        .sort({ startedAt: -1 })
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      IngestionLog.countDocuments(query),
    ]);

    res.status(200).json({ logs, total });
  } catch (error) {
    console.error("Fetch ingestion logs error:", error);
    res.status(500).json({ error: "Server error while fetching ingestion logs" });
  }
};

const setUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["Active", "Disabled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }

    const user = await User.findByIdAndUpdate(id, { status }, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: "User not found" });

    if (status === "Disabled") {
      await mongoose.connection.db
        .collection("sessions")
        .deleteMany({ "session.passport.user": id });
    }

    res.status(200).json({ message: `Account ${status.toLowerCase()}`, user });
  } catch (error) {
    console.error("Set user status error:", error);
    res.status(500).json({ error: "Server error while updating user status" });
  }
};

module.exports = { moderatePost, fetchModerationLogs, fetchIngestionLogs, setUserStatus };
