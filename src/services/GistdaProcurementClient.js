/**
 * GistdaProcurementClient.js
 *
 * Fetches procurement data from https://www.gistda.or.th/procurement/
 *
 * Approach: GISTDA runs a WordPress site with a custom theme that loads
 * procurement data via a WordPress AJAX call:
 *
 *   POST https://www.gistda.or.th/wp-admin/admin-ajax.php?egp_lang=en
 *   action=gistda_egp_list
 *   nonce=<nonce from inline <script> window.gistdaProcurement.nonce>
 *   page=<page number>
 *   per_page=<rows per page>
 *
 * The JSON response shape is:
 *   {
 *     "success": true,
 *     "data": {
 *       "rows": [{ "id", "project", "title", "type", "method", "date", "url" }, ...],
 *       "pagination": { "total", "pages", "page", "perPage" }
 *     }
 *   }
 *
 * We paginate until all pages have been fetched.
 */

const SOURCE = "gistda-procurement";
const PORTAL_URL = "https://www.gistda.or.th/procurement/";
const AJAX_URL = "https://www.gistda.or.th/wp-admin/admin-ajax.php?egp_lang=en";

const { Agent, fetch: undiciFetch } = require("undici");
const tlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

/** Minimal fetch with timeout and TLS-error tolerance. */
const fetchPage = async (url, { timeoutMs = 30000, headers = {}, body = null } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "User-Agent": "TORmax-public-aggregator/1.0",
        Accept: body ? "application/json,*/*" : "text/html,*/*",
        "Accept-Language": "en,th;q=0.5",
        ...(body ? { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" } : {}),
        ...headers,
      },
      body: body || undefined,
      signal: controller.signal,
      dispatcher: tlsDispatcher,
    });
    if (!res.ok) throw new Error(`GISTDA returned HTTP ${res.status}`);
    return body ? res.json() : res.text();
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Retrieve the WP nonce from the procurement portal page.
 * The nonce is embedded in an inline <script> block:
 *   window.gistdaProcurement = { ajaxUrl: "...", nonce: "xxxxxxxx", ... }
 */
const fetchNonce = async ({ timeoutMs = 30000 } = {}) => {
  const html = await fetchPage(PORTAL_URL, { timeoutMs });
  const match = html.match(/nonce:\s*["']([^"']+)['"]/);
  if (!match) {
    throw Object.assign(
      new Error("GISTDA Procurement: could not find nonce on portal page"),
      { code: "SOURCE_NO_NONCE" }
    );
  }
  return match[1];
};

/**
 * Fetch one page of results from the WP AJAX endpoint.
 */
const fetchOnePage = async (nonce, page, perPage, cookies = "", { timeoutMs = 30000 } = {}) => {
  const payload = `action=gistda_egp_list&nonce=${encodeURIComponent(nonce)}&page=${page}&per_page=${perPage}`;
  const data = await fetchPage(AJAX_URL, {
    timeoutMs,
    headers: {
      Referer: PORTAL_URL,
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: payload,
  });
  if (!data.success) {
    throw Object.assign(
      new Error(`GISTDA Procurement AJAX failed: ${JSON.stringify(data)}`),
      { code: "SOURCE_AJAX_FAILURE" }
    );
  }
  return data.data; // { rows, pagination }
};

/**
 * Parse a GISTDA row into a normalised record.
 * Row shape: { id, project, title, type, method, date, url }
 *
 * "project" is the e-GP project ID (e.g. "69099528075").
 * "id" is an internal GISTDA DB identifier.
 * "url" is either a direct PDF link or an e-GP HTML announcement URL.
 */
const parseRow = (row) => {
  // Prefer e-GP project number as external ID; fall back to GISTDA internal id
  const externalId = String(row.project || row.id || "").trim();

  // Parse date string "dd/mm/yyyy" → ISO
  let deadline;
  if (row.date) {
    const parts = row.date.split("/").map(Number);
    if (parts.length === 3) {
      const [d, m, y] = parts;
      if (!isNaN(d) && !isNaN(m) && !isNaN(y)) {
        deadline = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      }
    }
  }

  return {
    externalId,
    title: String(row.title || "").trim(),
    agency: "GISTDA",
    description: row.type ? `ประเภท: ${row.type}` : undefined,
    deadline,
    sourceUrl: row.url || PORTAL_URL,
    status: "Public",
    rawData: row,
  };
};

/**
 * Fetch all procurement listings from GISTDA, paginating through every page.
 */
const fetchListings = async ({
  perPage = Number(process.env.GISTDA_PER_PAGE || 50),
  maxPages = Number(process.env.GISTDA_MAX_PAGES || 20),
  timeoutMs = 30000,
} = {}) => {
  const nonce = await fetchNonce({ timeoutMs });
  const records = [];
  let currentPage = 1;

  for (let i = 0; i < maxPages; i++) {
    const { rows, pagination } = await fetchOnePage(nonce, currentPage, perPage, "", { timeoutMs });
    for (const row of rows || []) {
      records.push(parseRow(row));
    }

    const totalPages = pagination?.pages ?? 1;
    if (currentPage >= totalPages) break;
    currentPage += 1;
  }

  if (!records.length) {
    throw Object.assign(
      new Error("GISTDA Procurement: no rows returned from AJAX endpoint"),
      { code: "SOURCE_NO_ROWS" }
    );
  }

  return { source: SOURCE, sourceUrl: PORTAL_URL, records };
};

module.exports = {
  SOURCE,
  PORTAL_URL,
  AJAX_URL,
  fetchListings,
  fetchNonce,
  parseRow,
};

