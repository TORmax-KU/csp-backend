// Hold these fields until the corrected, evidence-based extractor is ready.
// Keep typed values empty; the UI translates pending state into display text.
function pendingTorExtraction() {
  return {
    budget: null, announcedAt: null, deadline: null, deadlinePrecision: "unknown",
    descriptions: "", requiredSkills: [], sourceSkillNames: [], aiAnalysis: {},
    analysisStatus: "pending", analysisHold: true,
    analysisError: "", analysisErrorCode: "", analysisAttempts: 0, analysisRetryCount: 0,
    analysisLease: null, analysisLeaseUntil: null, nextAnalysisAt: null,
    analyzedAt: null, aiModel: null, aiPromptVersion: null,
  };
}

module.exports = { pendingTorExtraction };
