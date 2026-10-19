function analysisError(code, message) {
  return Object.assign(new Error(message), { code });
}

function classifyAnalysisError(error) {
  let status = Number(error.status || error.code);
  try { status = Number(JSON.parse(error.message).error?.code) || status; } catch {}
  if ([429, 500, 502, 503, 504].includes(status) || ["TimeoutError", "AbortError"].includes(error.name)) {
    return { code: status === 429 ? "RATE_LIMITED" : "TEMPORARY_ERROR", status: "retry_pending", retryable: true };
  }
  if (["NO_TOR_DOCUMENT", "INSUFFICIENT_TOR_CONTENT"].includes(error.code)) {
    return { code: error.code, status: "awaiting_documents", retryable: false };
  }
  if (["DOCUMENT_LIMIT", "INVALID_AI_RESPONSE", "UNSUPPORTED_DOCUMENT"].includes(error.code)) {
    return { code: error.code, status: "needs_review", retryable: false };
  }
  return { code: "ANALYSIS_FAILED", status: "failed", retryable: false };
}

module.exports = { analysisError, classifyAnalysisError };
