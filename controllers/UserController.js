const User = require("../src/models/User");

const EDITABLE_FIELDS = [
  "username",
  "realName",
  "aboutMe",
  "proficiency",
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
  "dailyDigestEmail",
  "smsAlerts",
  "contactPhone",
];

const fetch = async (req, res) => {
  try {
    const { search, page = 1, limit = 10 } = req.query;

    let query = {};
    if (search) {
      const regex = { $regex: search, $options: "i" };
      query = { $or: [{ username: regex }, { realName: regex }, { email: regex }] };
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .skip((page - 1) * Number(limit))
        .limit(Number(limit)),
      User.countDocuments(query),
    ]);

    res.status(200).json({ users, total });
  } catch (error) {
    console.error("Fetch users error:", error);
    res.status(500).json({ error: "Server error while fetching users" });
  }
};

const fetchById = async (req, res) => {
  try {
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

    const patch = {};
    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] !== undefined) patch[field] = req.body[field];
    }

    const updated = await User.findByIdAndUpdate(id, patch, {
      new: true,
      runValidators: true,
    }).populate("proficiency");

    res.status(200).json(updated);
  } catch (error) {
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
