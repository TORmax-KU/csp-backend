// Public endpoint observed in the official announcement application's search service.
// Never generate a challenge token or bypass Cloudflare. Supply only authorized access.
const SOURCE = "gprocurement";
const SEARCH_PAGE = "https://process5.gprocurement.go.th/egp-agpc01-web/announcement";
const API = "https://process5.gprocurement.go.th/egp-oann10-service/pb/a-egp-allt-project/announcement";
const failure = (code, message) => Object.assign(new Error(message), { code });

function readSearchResponse(payload) {
  if (payload?.validateCfTurnTile === false || payload?.validateCfTurnTile === 0) throw failure("SOURCE_ACCESS_REQUIRED", "e-GP requires Cloudflare verification. Automatic import needs authorized source access; no records were imported.");
  if (payload?.validateAnnouncementToken === false || payload?.validateAnnouncementToken === 0) throw failure("SOURCE_ACCESS_REQUIRED", "e-GP announcement access has expired or was rejected.");
  if (payload?.data?.elasticSearchError) throw failure("SOURCE_UNAVAILABLE", "e-GP search is temporarily unavailable.");
  const rows = Array.isArray(payload?.data) ? payload.data : payload?.data?.data;
  if (!Array.isArray(rows)) throw failure("SOURCE_SCHEMA_CHANGED", "Unrecognized e-GP search response; no data was published.");
  return rows;
}

function budgetYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit" }).formatToParts(now);
  return Number(parts.find(p => p.type === "year").value) + 543 + (Number(parts.find(p => p.type === "month").value) >= 10 ? 1 : 0);
}

async function fetchAnnouncements({ page = 1, year = budgetYear(), keyword = "ซอฟต์แวร์", fetchImpl = fetch } = {}) {
  const url = new URL(API);
  for (const [key, value] of Object.entries({ budgetYear: year, keywordSearch: keyword, announcementTodayFlag: false, page })) url.searchParams.set(key, String(value));
  const headers = { accept: "application/json", "user-agent": "TORmax-public-aggregator/2.0" };
  if (process.env.GPROC_ANNOUNCEMENT_TOKEN) headers["X-Announcement-Token"] = process.env.GPROC_ANNOUNCEMENT_TOKEN;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000), redirect: "error" });
  if (!response.ok) throw failure(response.status === 403 || response.status === 401 ? "SOURCE_ACCESS_REQUIRED" : "SOURCE_UNAVAILABLE", `e-GP returned HTTP ${response.status}`);
  let payload;
  try { payload = await response.json(); } catch { throw failure("SOURCE_SCHEMA_CHANGED", "e-GP returned a non-JSON response."); }
  return { rows: readSearchResponse(payload), sourceUrl: url.href };
}

module.exports = { SOURCE, API, SEARCH_PAGE, fetchAnnouncements, readSearchResponse, budgetYear };
