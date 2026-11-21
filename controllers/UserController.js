const User = require("../src/models/User");
const { parseSkillNames, findOrCreateSkill } = require("../src/services/SkillCatalog");
const { runMatching } = require("../src/services/MatchingEngine");
const { validateProfilePatch } = require("../src/services/ProfileValidation");

const EDITABLE_FIELDS = [
  "username",
  "realName",
  "aboutMe",
  "associations",
  "companyName",
  "taxId",
  "registeredCapital",
  "yearsInBusiness",
  "iso27001",
  "iso9001",
  "iso20000",
  "nbtcLicense",
  "trackedKeywords",
  "matchThreshold",
  "notifyMatchesInApp",
  "notifyMatchesEmail",
  "notifyHighBudgetInApp",
  "notifyHighBudgetEmail",
  "dailyDigestEmail",
  "smsAlerts",
  "contactPhone",
  "minBudget",
  "maxBudget",
  "teamSize",
  "capacity",
];

// Changing any of these re-runs matching for the user (Use Case 2).
const ALERT_FIELDS = ["notifyMatchesInApp", "notifyMatchesEmail", "notifyHighBudgetInApp", "notifyHighBudgetEmail"];
const MATCHING_FIELDS = ["skillNames", "minBudget", "maxBudget", "matchThreshold", ...ALERT_FIELDS];

const fetch = async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 10);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: "Page must be a positive integer and limit between 1 and 100" });
    }
    const { role, status } = req.query;
    if (role !== undefined && (typeof role !== "string" || !["Vendor", "JobLister", "Admin"].includes(role))) return res.status(400).json({ error: "Invalid role" });
    if (status !== undefined && (typeof status !== "string" || !["Active", "Disabled"].includes(status))) return res.status(400).json({ error: "Invalid status" });
    const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 200) : "";

    const query = {};
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      // Literal match: admin input is never interpreted as a regular expression.
      const regex = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      query.$or = [{ username: regex }, { realName: regex }, { email: regex }, { companyName: regex }];
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("email realName username companyName role status createdAt")
        .sort({ createdAt: -1, _id: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      User.countDocuments(query),
    ]);

    res.status(200).json({ users, total, page, limit });
  } catch (error) {
    console.error("Fetch users error:", error);
    res.status(500).json({ error: "Server error while fetching users" });
  }
};

const fetchById = async (req, res) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(404).json({ message: "User not found" });
    const user = await User.findById(req.params.id).populate("proficiency");
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(user);
  } catch (error) {
    console.error("Fetch user error:", error);
    res.status(500).json({ error: "Server error while fetching user" });
  }
};

const update = async (req, res) => {
  try {
    const { id } = req.params;

    // only the owner can edit their own profile
    if (req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const errors = validateProfilePatch(req.body, user);
    if (Object.keys(errors).length) return res.status(400).json({ message: "Please fix the highlighted fields", errors, error: Object.values(errors).join(", ") });
    const patch = {};
    for (const field of ALERT_FIELDS) {
      if (req.body[field] !== undefined && typeof req.body[field] !== "boolean") {
        return res.status(400).json({ message: `${field} must be a boolean` });
      }
    }
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }

    if (req.body.skillNames !== undefined) {
      const parsed = parseSkillNames(req.body.skillNames);
      if (parsed.error) {
        return res.status(400).json({ message: parsed.error });
      }

      const skills = await Promise.all(parsed.names.map(findOrCreateSkill));
      patch.proficiency = skills.map((skill) => skill._id);
    }

    const updated = await User.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    }).populate("proficiency");

    if (MATCHING_FIELDS.some((field) => req.body[field] !== undefined)) {
      runMatching({ userIds: [updated._id] }).catch((error) =>
        console.error("Profile re-match error:", error));
    }

    res.status(200).json(updated);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "This username is already in use" });
    if (error.name === "ValidationError") {
      const messages = Object.values(error.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join(", ") });
    }

    console.error("Update user error:", error);
    res.status(500).json({ error: "Something went wrong while updating user" });
  }
};

const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // only the owner can delete their own account
    if (req.user._id.toString() !== id) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    await User.findByIdAndDelete(id);
    res.status(200).json({ message: "User deleted" });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({ error: "Something went wrong while deleting user" });
  }
};

module.exports = { fetch, fetchById, update, deleteUser };
