const mongoose = require("mongoose");
const User = require("../src/models/User");
const Project = require("../src/models/Project");
const ModerationLog = require("../src/models/ModerationLog");
const IngestionLog = require("../src/models/IngestionLog");
const Notification = require("../src/models/Notification");
const PostReport = require("../src/models/PostReport");
const { runBangkokOnce, ingestionStatus } = require("../src/services/IngestionScheduler");
const { ingestionHealth } = require("../src/services/IngestionHealth");
const { DIRECT_SOURCE } = require("../src/services/ProcurementAvailability");
const { requestMatching } = require("../src/services/MatchingEngine");

const MAX_REASON = 500;

// FR-14 / NFR-11 / Use Case 5: remove a policy-violating job posting and disable its publisher.
//
// No transaction: the Docker MongoDB is a standalone server, which rejects transactions. Instead
// every step is idempotent and ordered so a failure part-way is safe to retry:
//   1. disable the publisher and revoke their sessions (a failure never leaves them able to post)
//   2. close their other open postings, so a disabled account's listings stop reaching vendors
//   3. write the moderation log, keyed by posting, with a snapshot of what was removed
//   4. delete the posting, then tidy reports and vendor notifications that pointed at it
const moderatePost = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "Posting not found" });
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
    if (!reason) return res.status(400).json({ message: "Give a reason for removing this posting", errors: { reason: "Give a reason for removing this posting" } });
    if (reason.length > MAX_REASON) return res.status(400).json({ message: `Reason must be ${MAX_REASON} characters or fewer`, errors: { reason: `Reason must be ${MAX_REASON} characters or fewer` } });

    const project = await Project.findById(id).select("title source publisherId").lean();
    if (!project) return res.status(404).json({ message: "Posting not found" });
    // Government TORs have no publisher account; misclassified ones go through classification reports.
    if (project.source !== DIRECT_SOURCE || !project.publisherId) {
      return res.status(400).json({ message: "Only direct job postings can be removed here. Use classification reports for government TORs." });
    }

    const publisher = await User.findById(project.publisherId).select("email role").lean();
    // An admin is never locked out by moderation, including their own account.
    const disable = Boolean(publisher) && publisher.role !== "Admin" && String(publisher._id) !== String(req.user._id);

    if (disable) {
      await User.updateOne({ _id: publisher._id }, { $set: { status: "Disabled" }, $inc: { sessionVersion: 1 } });
    }
    const closed = disable
      ? await Project.updateMany({ _id: { $ne: project._id }, source: DIRECT_SOURCE, publisherId: publisher._id, procurementStatus: "open" },
        { $set: { procurementStatus: "closed" } })
      : { modifiedCount: 0 };

    // $setOnInsert keeps the first attempt's record if an admin retries after a partial failure.
    await ModerationLog.findOneAndUpdate({ targetProjectId: project._id }, { $setOnInsert: {
      adminId: req.user._id,
      targetProjectId: project._id,
      targetUserId: project.publisherId,
      reason,
      projectTitle: project.title || "",
      publisherEmail: publisher?.email || "",
      accountDisabled: disable,
      otherPostingsClosed: closed.modifiedCount || 0,
    } }, { upsert: true, setDefaultsOnInsert: true });

    await Project.deleteOne({ _id: project._id });
    const [reports] = await Promise.all([
      PostReport.updateMany({ projectId: project._id, status: "open" },
        { $set: { status: "resolved", outcome: "removed", resolvedBy: req.user._id, resolvedAt: new Date() } }),
      Notification.updateMany({ projectId: project._id }, { $set: { deleted: true } }),
    ]);
    // Drops vendor matches on the deleted posting on the next sweep instead of waiting 5 minutes.
    requestMatching(1000);

    res.status(200).json({
      message: disable ? "Posting removed and publisher account disabled" : "Posting removed",
      accountDisabled: disable,
      otherPostingsClosed: closed.modifiedCount || 0,
      reportsResolved: reports.modifiedCount || 0,
    });
  } catch (error) {
    console.error("Moderate post error:", error);
    res.status(500).json({ error: "Server error while removing the posting" });
  }
};

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const pageParams = query => {
  const page = Number(query.page ?? 1);
  const limit = Number(query.limit ?? 20);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) return null;
  return { page, limit };
};

// UC5: every direct posting (open or closed) with its publisher and open report count, for review.
const fetchPosts = async (req, res) => {
  try {
    const paging = pageParams(req.query);
    if (!paging) return res.status(400).json({ error: "Page must be a positive integer and limit between 1 and 100" });
    const status = req.query.status || "all";
    if (!["open", "closed", "all"].includes(status)) return res.status(400).json({ error: "Status must be open, closed or all" });
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : "";

    const now = new Date();
    const query = { source: DIRECT_SOURCE };
    if (status === "open") Object.assign(query, { procurementStatus: "open", deadline: { $gt: now } });
    if (status === "closed") query.$or = [{ procurementStatus: { $ne: "open" } }, { deadline: { $lte: now } }];
    if (search) {
      const regex = { $regex: escapeRegex(search), $options: "i" };
      query.$and = [{ $or: [{ title: regex }, { agency: regex }, { externalId: regex }, { "contact.email": regex }] }];
    }

    const [posts, total] = await Promise.all([
      Project.find(query)
        .select("title agency externalId budget budgetMin deadline procurementStatus contact publisherId createdAt")
        .populate("publisherId", "email realName companyName status role")
        .sort({ createdAt: -1, _id: -1 })
        .skip((paging.page - 1) * paging.limit).limit(paging.limit).lean(),
      Project.countDocuments(query),
    ]);
    const counts = await PostReport.aggregate([
      { $match: { projectId: { $in: posts.map(post => post._id) }, status: "open" } },
      { $group: { _id: "$projectId", count: { $sum: 1 } } },
    ]);
    const openReports = new Map(counts.map(row => [String(row._id), row.count]));

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      posts: posts.map(post => ({ ...post, open: post.procurementStatus === "open" && post.deadline > now, openReports: openReports.get(String(post._id)) || 0 })),
      total, ...paging,
    });
  } catch (error) {
    console.error("Fetch posts error:", error);
    res.status(500).json({ error: "Server error while fetching postings" });
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
const INGESTION_LOG_STATUSES = ["Success", "Failed"];

const fetchIngestionLogs = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    if (status !== undefined && !INGESTION_LOG_STATUSES.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

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

// NFR-08 / Use Case 6: success rate per source against the 95% target, plus live scheduler state.
const fetchIngestionHealth = async (req, res) => {
  try {
    const days = Number(req.query.days ?? 7);
    if (!Number.isInteger(days) || days < 1 || days > 90) return res.status(400).json({ error: "days must be an integer from 1 to 90" });
    const health = await ingestionHealth({ days });
    const live = new Map(ingestionStatus().sources.map(state => [state.source, state]));
    // Include enabled sources that have not logged a run in the window yet.
    for (const source of live.keys()) {
      if (!health.sources.some(s => s.source === source)) health.sources.push({ source, runs: 0, succeeded: 0, failed: 0, empty: 0, successRate: null, consecutiveProblems: 0, alerting: false });
    }
    health.sources = health.sources.map(s => ({ ...s, scheduler: live.get(s.source) || null }));
    res.set("Cache-Control", "no-store");
    res.status(200).json(health);
  } catch (error) {
    console.error("Fetch ingestion health error:", error);
    res.status(500).json({ error: "Server error while computing ingestion health" });
  }
};

// Keep the existing admin route and run the working Bangkok importer.
const triggerBangkokEgpIngestion = (req, res) => {
  const state = ingestionStatus();
  if (state.status === "running") return res.status(409).json({ message: "Ingestion is already running" });
  void runBangkokOnce();
  return res.status(202).json({ message: "Bangkok e-GP ingestion started", source: "bangkok-egp" });
};

const setUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!mongoose.isValidObjectId(id)) return res.status(404).json({ message: "User not found" });
    if (!["Active", "Disabled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status value" });
    }
    if (String(req.user._id) === String(id)) {
      return res.status(400).json({ message: "You cannot change your own account status" });
    }
    if (status === "Disabled") {
      const target = await User.findById(id);
      if (!target) return res.status(404).json({ message: "User not found" });
      // Admin accounts are managed outside the console (scripts/create-admin.js).
      if (target.role === "Admin") return res.status(403).json({ message: "Admin accounts cannot be disabled here" });
    }

    const patch = { $set: { status } };
    if (status === "Disabled") patch.$inc = { sessionVersion: 1 };
    const user = await User.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json({ message: `Account ${status.toLowerCase()}`, user });
  } catch (error) {
    console.error("Set user status error:", error);
    res.status(500).json({ error: "Server error while updating user status" });
  }
};

module.exports = {
  moderatePost,
  fetchPosts,
  fetchModerationLogs,
  fetchIngestionLogs,
  fetchIngestionHealth,
  triggerBangkokEgpIngestion,
  setUserStatus,
};
