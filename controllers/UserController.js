const User = require("../src/models/User");
const Skill = require("../src/models/Skill");

const MAX_USER_SKILLS = 30;
const MAX_SKILL_NAME_LENGTH = 60;
const DEFAULT_SKILL_CATEGORIES = new Map([
  ["python", "Programming Language"],
  ["c", "Programming Language"],
  ["c++", "Programming Language"],
  ["c#", "Programming Language"],
  ["assembly", "Programming Language"],
  ["java", "Programming Language"],
  ["javascript", "Programming Language"],
  ["typescript", "Programming Language"],
  ["go", "Programming Language"],
  ["rust", "Programming Language"],
  ["php", "Programming Language"],
  ["ruby", "Programming Language"],
  ["kotlin", "Programming Language"],
  ["swift", "Programming Language"],
  ["dart", "Programming Language"],
  ["r", "Programming Language"],
  ["matlab", "Programming Language"],
  ["bash", "Scripting"],
  ["powershell", "Scripting"],
  ["react", "Framework"],
  ["node.js", "Framework"],
  ["docker", "DevOps"],
  ["kubernetes", "DevOps"],
  ["git", "DevOps"],
  ["linux", "Operating System"],
  ["windows", "Operating System"],
  ["aws", "Cloud"],
  ["azure", "Cloud"],
  ["mongodb", "Database"],
  ["sql", "Database"],
]);

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
  "dailyDigestEmail",
  "smsAlerts",
  "contactPhone",
];

const normalizeSkillName = (name) =>
  name.trim().replace(/\s+/g, " ").normalize("NFKC");

const parseSkillNames = (value) => {
  if (!Array.isArray(value)) {
    return { error: "skillNames must be an array of strings" };
  }

  const names = [];
  const seen = new Set();

  for (const rawName of value) {
    if (typeof rawName !== "string") {
      return { error: "Every skill name must be a string" };
    }

    const name = normalizeSkillName(rawName);
    if (!name) continue;

    if (name.length > MAX_SKILL_NAME_LENGTH) {
      return { error: `Skill names cannot exceed ${MAX_SKILL_NAME_LENGTH} characters` };
    }

    const key = name.toLocaleLowerCase("en-US");
    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }

  if (names.length > MAX_USER_SKILLS) {
    return { error: `A user can save up to ${MAX_USER_SKILLS} skills` };
  }

  return { names };
};

const findOrCreateSkill = async (name) => {
  const normalizedName = name.toLocaleLowerCase("en-US");
  let skill = await Skill.findOne({ normalizedName });

  if (!skill) {
    skill = await Skill.findOne({
      name: { $regex: `^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, $options: "i" },
    });
  }

  if (skill) {
    if (!skill.normalizedName) {
      skill.normalizedName = normalizedName;
      await skill.save();
    }
    return skill;
  }

  try {
    return await Skill.create({
      name,
      normalizedName,
      category: DEFAULT_SKILL_CATEGORIES.get(normalizedName) || "General",
    });
  } catch (error) {
    if (error.code === 11000) {
      const existingSkill = await Skill.findOne({ normalizedName });
      if (existingSkill) return existingSkill;
    }
    throw error;
  }
};

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
