// Shared by vendor profiles and job postings: validate skill names and resolve them to catalog entries.
const Skill = require("../models/Skill");

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
for (const group of require('./RecommendedSkills').RECOMMENDED_SKILL_GROUPS) {
  for (const name of group.skills) {
    const key = name.toLocaleLowerCase('en-US');
    if (!DEFAULT_SKILL_CATEGORIES.has(key)) DEFAULT_SKILL_CATEGORIES.set(key, group.category);
  }
}

const normalizeSkillName = (name) =>
  name.trim().replace(/\s+/g, " ").normalize("NFKC");

const parseSkillNames = (value, { max = MAX_USER_SKILLS, owner = "A user" } = {}) => {
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

  if (names.length > max) {
    return { error: `${owner} can save up to ${max} skills` };
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

module.exports = { MAX_USER_SKILLS, MAX_SKILL_NAME_LENGTH, DEFAULT_SKILL_CATEGORIES, normalizeSkillName, parseSkillNames, findOrCreateSkill };
