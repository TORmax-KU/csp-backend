// NFR-04: a government portal that does not start responding within 30 seconds is abandoned.
// The scheduler logs the failure and retries on its next cycle without crashing the backend.
//
// Two limits: the response limit covers connecting and receiving headers (a dead or hung
// portal); the body limit covers downloading a response that has started, so large but
// healthy listings are not cut off.
const SOURCE_RESPONSE_TIMEOUT_MS = 30 * 1000;
const SOURCE_BODY_TIMEOUT_MS = 120 * 1000;

const timeoutError = message => Object.assign(new Error(message), { name: "TimeoutError", code: "SOURCE_TIMEOUT" });

// `read` receives the Response and returns the parsed body (and may throw on bad status/content).
async function fetchSource(url, init = {}, {
  read = response => response,
  fetchImpl = fetch,
  responseTimeoutMs = SOURCE_RESPONSE_TIMEOUT_MS,
  bodyTimeoutMs = SOURCE_BODY_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const host = (() => { try { return new URL(url).host; } catch { return "source"; } })();
  let timer = setTimeout(() => controller.abort(timeoutError(`${host} did not respond within ${responseTimeoutMs / 1000} seconds`)), responseTimeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(timeoutError(`${host} response did not finish within ${bodyTimeoutMs / 1000} seconds`)), bodyTimeoutMs);
    return await read(response);
  } catch (error) {
    // Surface our own timeout rather than a generic AbortError.
    if (controller.signal.aborted && controller.signal.reason?.code === "SOURCE_TIMEOUT") throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchSource, SOURCE_RESPONSE_TIMEOUT_MS, SOURCE_BODY_TIMEOUT_MS };
