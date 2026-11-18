const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeSkill, resolveSkills, calculateMatch } = require("../src/services/SkillMatching");

test("normalizeSkill trims, collapses whitespace, lowercases and applies aliases", () => {
  assert.equal(normalizeSkill("  Docker   Compose "), "docker compose");
  assert.equal(normalizeSkill("NodeJS"), "node.js");
  assert.equal(normalizeSkill("node  js"), "node.js");
  assert.equal(normalizeSkill("React.js"), "react");
  assert.equal(normalizeSkill("Postgres"), "postgresql");
  // Full-width characters (common in pasted Thai documents) fold to ASCII.
  assert.equal(normalizeSkill("ＳＱＬ"), "sql");
});

test("resolveSkills maps aliases to one catalog ID and reports names it cannot map", () => {
  const vocabulary = [{ name: "Node.js", _id: "node" }, { name: "React", _id: "react" }];
  const result = resolveSkills(["nodejs", "Node JS", "ReactJS", "Kubernetes"], vocabulary);
  assert.deepEqual(result.requiredSkills, ["node", "react"]);
  assert.deepEqual(result.unmappedSkillNames, ["Kubernetes"]);
});

test("calculateMatch rounds partial matches to two decimals", () => {
  const project = { analysisStatus: "completed", requiredSkills: ["a", "b", "c"] };
  const match = calculateMatch(project, ["a"]);
  assert.equal(match.matchPercentage, 33.33);
  assert.deepEqual(match.matchedSkillIds, ["a"]);
  assert.deepEqual(match.missingSkillIds, ["b", "c"]);
  assert.equal(match.requiredCount, 3);
});

test("calculateMatch withholds a score while any extracted skill is unmapped", () => {
  const project = { analysisStatus: "completed", requiredSkills: ["a"], aiAnalysis: { unmappedSkillNames: ["COBOL"] } };
  const match = calculateMatch(project, ["a"]);
  assert.equal(match.matchPercentage, null);
  assert.match(match.reason, /unmapped/);
});
