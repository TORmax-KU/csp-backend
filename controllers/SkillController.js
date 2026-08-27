const Skill = require("../src/models/Skill");

const fetch = async (req, res) => {
  try {
    const { search, category } = req.query;

    const query = {};
    if (search) query.name = { $regex: search, $options: "i" };
    if (category) query.category = { $regex: category, $options: "i" };

    const skills = await Skill.find(query).sort({ name: 1 });
    res.status(200).json(skills);
  } catch (error) {
    console.error("Fetch skills error:", error);
    res.status(500).json({ error: "Server error while fetching skills" });
  }
};

const create = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Only Admins can create skills" });
    }

    const { name, category } = req.body;
    if (!name) return res.status(400).json({ message: "Skill name is required" });

    const skill = await Skill.create({ name, category });
    res.status(201).json(skill);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "Skill already exists" });
    }
    console.error("Create skill error:", error);
    res.status(500).json({ error: "Server error while creating skill" });
  }
};

const deleteSkill = async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Only Admins can delete skills" });
    }

    const skill = await Skill.findByIdAndDelete(req.params.id);
    if (!skill) return res.status(404).json({ message: "Skill not found" });

    res.status(200).json({ message: "Skill deleted" });
  } catch (error) {
    console.error("Delete skill error:", error);
    res.status(500).json({ error: "Server error while deleting skill" });
  }
};

module.exports = { fetch, create, deleteSkill };
