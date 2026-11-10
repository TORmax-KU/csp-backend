const Match = require("../src/models/Match");
const Project = require("../src/models/Project");
const { availability, publicProjectQuery } = require("../src/services/ProcurementAvailability");
const { DEFAULT_THRESHOLD } = require("../src/services/MatchingEngine");

const MAX_LIMIT = 100;
const time = value => (value ? new Date(value).getTime() : Infinity);

// UC1 / FR-11: the signed-in vendor's matched TORs that are still open, best match first.
// Matches on TORs that left the open feed stay stored (for StatusChange alerts) but are not listed.
const fetchForUser = async (req, res) => {
  try {
    const page = Number(req.query.page ?? 1);
    const limit = Number(req.query.limit ?? 20);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return res.status(400).json({ error: `Page must be a positive integer and limit must be between 1 and ${MAX_LIMIT}` });
    }

    const user = req.user;
    const matches = await Match.find({ userId: user._id }).select("projectId matchPercentage matchedSkillIds").lean();
    const byProject = new Map(matches.map(match => [String(match.projectId), match]));

    // Bounded by the number of open TORs, so sorting and paging in memory stays cheap.
    const projects = byProject.size ? await Project.find({ ...publicProjectQuery(new Date()), _id: { $in: [...byProject.keys()] } })
      .select("-rawData -analysisError -analysisLease")
      .populate("requiredSkills", "name category")
      .populate("publisherId", "username")
      .lean() : [];

    const items = projects.map(project => {
      const match = byProject.get(String(project._id));
      return { ...project, availability: availability(project),
        match: { percentage: match.matchPercentage, matchedSkillIds: match.matchedSkillIds || [] } };
    }).sort((a, b) => (b.match.percentage ?? 0) - (a.match.percentage ?? 0)
      || time(a.deadline) - time(b.deadline)
      || String(a._id).localeCompare(String(b._id)));

    res.set("Cache-Control", "no-store");
    res.status(200).json({
      projects: items.slice((page - 1) * limit, page * limit),
      total: items.length, page, limit,
      // Lets the page explain an empty list: wrong role, no skills yet, or filters too narrow.
      profile: {
        isVendor: user.role === "Vendor",
        hasSkills: (user.proficiency || []).length > 0,
        matchThreshold: user.matchThreshold ?? DEFAULT_THRESHOLD,
        minBudget: user.minBudget ?? null,
        maxBudget: user.maxBudget ?? null,
      },
    });
  } catch (error) {
    console.error("Fetch matches error:", error);
    res.status(500).json({ error: "Server error while fetching matches" });
  }
};

module.exports = { fetchForUser };
