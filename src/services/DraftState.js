// FR-05: a TOR in draft (published for public comment) versus public/announced.
//
// `status: "Draft"` and `procurementStatus: "draft"` always move together. Drafts are listed
// with their source metadata only: Vertex analysis is skipped while in draft (AI budget) and
// re-queued as soon as the official invitation appears.

const DRAFT_SKIP_REASON = "Draft TOR: analysed once the official invitation is published";

function draftFields(draftPublishedAt) {
  return { status: "Draft", procurementStatus: "draft", ...(draftPublishedAt ? { draftPublishedAt } : {}) };
}

// The TOR left draft. Analysis was switched off while it was a draft, so turn it back on;
// the worker re-checks every skip rule (deadline, terminal status) before calling Vertex.
function leftDraftFields() {
  return {
    status: "Public",
    analysisStatus: "pending", analysisAutoEligible: true, analysisHold: false, analysisSkipReason: "",
    analysisError: "", analysisErrorCode: "", analysisRetryCount: 0, nextAnalysisAt: null,
  };
}

module.exports = { DRAFT_SKIP_REASON, draftFields, leftDraftFields };
