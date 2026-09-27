const aliases = new Map([["nodejs", "node.js"], ["node js", "node.js"], ["reactjs", "react"], ["react.js", "react"], ["postgres", "postgresql"]]);
function normalizeSkill(name) {
  const normalized = name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return aliases.get(normalized) || normalized;
}
function resolveSkills(names, skills) {
  const vocabulary = new Map(skills.map(s => [normalizeSkill(s.name), s]));
  const unique = [...new Map(names.map(name => [normalizeSkill(name), name])).values()];
  return {
    requiredSkills: [...new Set(unique.map(name => vocabulary.get(normalizeSkill(name))?._id.toString()).filter(Boolean))],
    unmappedSkillNames: unique.filter(name => !vocabulary.has(normalizeSkill(name))),
  };
}
async function ensureRequiredSkills(analysis, vocabulary, model) {
  const mapped = resolveSkills(analysis.mandatorySkills, vocabulary);
  // Only the v2 analyzer's documented skills may create catalog entries.
  for (const name of mapped.unmappedSkillNames) {
    if (!analysis.skillEvidence?.some(e => e.name === name && e.quote?.trim())) continue;
    const canonical = normalizeSkill(name);
    const normalizedName = canonical;
    let skill = await model.findOne({ normalizedName });
    if (!skill) {
      try { skill = await model.create({ name: canonical, category: "Technical", normalizedName }); }
      catch (error) {
        if (error.code !== 11000) throw error;
        skill = await model.findOne({ normalizedName });
        if (!skill) throw error;
      }
    }
    vocabulary.push(skill);
  }
  return resolveSkills(analysis.mandatorySkills, vocabulary);
}
function calculateMatch(project, userSkills) {
  const required = [...new Set((project.requiredSkills || []).map(s => (s._id || s).toString()))];
  const owned = new Set((userSkills || []).map(s => (s._id || s).toString()));
  const matchedSkillIds = required.filter(id => owned.has(id));
  const missingSkillIds = required.filter(id => !owned.has(id));
  const ready = project.analysisStatus === "completed" && !project.aiAnalysis?.unmappedSkillNames?.length && required.length > 0;
  return { matchPercentage: ready ? Math.round(matchedSkillIds.length / required.length * 10000) / 100 : null,
    matchedSkillIds, missingSkillIds, requiredCount: required.length,
    reason: ready ? null : "Analysis incomplete, unmapped skills, or no mandatory skills" };
}
module.exports = { normalizeSkill, resolveSkills, calculateMatch, ensureRequiredSkills };
