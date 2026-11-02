const Project = require("../models/Project");
const User = require("../models/User");
const Skill = require("../models/Skill");
const Match = require("../models/Match");
const Notification = require("../models/Notification");
const { publicProjectQuery } = require("./ProcurementAvailability");
const { resolveSkills, calculateMatch } = require("./SkillMatching");

const DEFAULT_THRESHOLD = 75;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const defaultModels = { projects: Project, users: User, skills: Skill, matches: Match, notifications: Notification };

// State a vendor is told about. "unknown" is transient while a TOR is re-verified, so it is never reported.
function trackedState(project) {
  if (project.status === "Draft") return "draft";
  return project.procurementStatus === "unknown" ? null : project.procurementStatus;
}

// FR-08: skill coverage must reach the vendor's threshold and the budget must sit inside their declared range.
function scoreProject(project, user, catalog) {
  // Re-resolve like GET /api/projects/:id/match so a notification never disagrees with the TOR page.
  const names = project.aiAnalysis?.mandatorySkillNames;
  const resolved = project.analysisStatus === "completed" && names?.length
    ? resolveSkills(names, catalog)
    : { requiredSkills: project.requiredSkills, unmappedSkillNames: project.aiAnalysis?.unmappedSkillNames || [] };
  const result = calculateMatch({ ...project, requiredSkills: resolved.requiredSkills,
    aiAnalysis: { ...project.aiAnalysis, unmappedSkillNames: resolved.unmappedSkillNames } }, user.proficiency);

  if (result.matchPercentage === null || result.matchPercentage < (user.matchThreshold ?? DEFAULT_THRESHOLD)) return null;
  if (typeof project.budget === "number") {
    if (user.minBudget != null && project.budget < user.minBudget) return null;
    if (user.maxBudget != null && project.budget > user.maxBudget) return null;
  }
  return result;
}

// Duplicate-key errors mean a concurrent run already inserted the same match.
const ignoreDuplicate = error => { if (error.code !== 11000) throw error; return {}; };

// Safe to run concurrently (scheduler + profile saves, or several backends): the unique
// (userId, projectId) index and conditional state updates ensure each event notifies once.
async function runMatching({ userIds, now = new Date(), models = defaultModels } = {}) {
  const { projects, users, skills, matches, notifications } = models;
  const counts = { newMatches: 0, removed: 0, statusChanges: 0 };

  const vendorFilter = { role: "Vendor", status: "Active", "proficiency.0": { $exists: true } };
  if (userIds) vendorFilter._id = { $in: userIds };
  const [vendors, candidates, catalog] = await Promise.all([
    users.find(vendorFilter).select("proficiency minBudget maxBudget matchThreshold").lean(),
    projects.find(publicProjectQuery(now))
      .select("status procurementStatus budget requiredSkills analysisStatus aiAnalysis.mandatorySkillNames aiAnalysis.unmappedSkillNames")
      .lean(),
    skills.find({}).select("name").lean(),
  ]);

  const existing = new Map((await matches.find({ userId: { $in: vendors.map(v => v._id) } })
    .select("userId projectId matchPercentage").lean())
    .map(m => [`${m.userId}:${m.projectId}`, m]));

  // FR-08 / FR-10: create, refresh or drop matches for currently open TORs.
  // Matches on TORs that have left the open feed are kept so their state changes can be reported.
  for (const user of vendors) {
    for (const project of candidates) {
      const key = `${user._id}:${project._id}`;
      const previous = existing.get(key);
      const result = scoreProject(project, user, catalog);

      if (!result) {
        if (previous) {
          await matches.deleteOne({ _id: previous._id });
          counts.removed += 1;
        }
        continue;
      }
      if (previous?.matchPercentage === result.matchPercentage) continue;

      const write = await matches.updateOne(
        { userId: user._id, projectId: project._id },
        { $set: { matchPercentage: result.matchPercentage, matchedSkillIds: result.matchedSkillIds },
          $setOnInsert: { notifiedState: trackedState(project) } },
        { upsert: true }
      ).catch(ignoreDuplicate);

      if (write.upsertedCount) {
        await notifications.create({ userId: user._id, projectId: project._id, type: "NewMatch",
          matchPercentage: result.matchPercentage });
        counts.newMatches += 1;
      }
    }
  }

  // FR-10: report state changes (e.g. open -> cancelled) on every matched TOR, open or not.
  const tracked = await matches.find(userIds ? { userId: { $in: userIds } } : {})
    .select("userId projectId notifiedState").lean();
  const current = new Map((await projects.find({ _id: { $in: [...new Set(tracked.map(m => String(m.projectId)))] } })
    .select("status procurementStatus").lean())
    .map(p => [String(p._id), p]));

  for (const match of tracked) {
    const project = current.get(String(match.projectId));
    if (!project) {
      await matches.deleteOne({ _id: match._id });
      counts.removed += 1;
      continue;
    }
    const state = trackedState(project);
    if (!state || state === match.notifiedState) continue;

    const claim = await matches.updateOne({ _id: match._id, notifiedState: match.notifiedState }, { $set: { notifiedState: state } });
    // A first known state is recorded silently; there is no earlier state to report a change from.
    if (!claim.modifiedCount || !match.notifiedState) continue;

    await notifications.create({ userId: match.userId, projectId: match.projectId, type: "StatusChange",
      fromState: match.notifiedState, toState: state });
    counts.statusChanges += 1;
  }

  return counts;
}

function startMatchingScheduler() {
  if (String(process.env.MATCHING_ENABLED ?? "true").trim().toLowerCase() === "false") return;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const counts = await runMatching();
      if (counts.newMatches || counts.removed || counts.statusChanges) {
        console.log(`Matching: ${counts.newMatches} new, ${counts.removed} removed, ${counts.statusChanges} status changes`);
      }
    } catch (error) {
      console.error("Matching sweep failed:", error.message);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref();
  void tick();
  return timer;
}

module.exports = { runMatching, scoreProject, trackedState, startMatchingScheduler };
