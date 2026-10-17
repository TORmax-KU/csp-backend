/**
 * EgatBiddingClient.js
 *
 * Scraper for https://bidding.egat.co.th/procure/procure_list.php
 *
 * Approach: The page renders project rows directly in the server-side HTML
 * (no auth needed for the public list). We parse the <tbody> table rows with
 * a lightweight regex/DOM-less approach.
 *
 * Columns (thead order):
 *   เลขที่โครงการ | หน่วยงานจัดหา | วิธีการจัดหา | ประเภท | ชื่อโครงการ
 *
 * Detail page pattern:
 *   https://bidding.egat.co.th/procure/project/index.php?project_id=<id>
 */

const SOURCE = "egat-bidding";
const LIST_URL = "https://bidding.egat.co.th/procure/procure_list.php";
const DETAIL_BASE = "https://bidding.egat.co.th/procure/project/index.php?project_id=";

const fetchHtml = async (url, { timeoutMs = 30000, headers = {} } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TORmax-public-aggregator/1.0",
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "th,en;q=0.5",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`EGAT Bidding returned HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Parse table rows from the EGAT bidding HTML page.
 * Returns an array of normalised record objects.
 */
const parseRows = (html) => {
  // Extract <tbody> content
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return [];
  const tbody = tbodyMatch[1];

  // Split into <tr> blocks
  const trMatches = [...tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  const records = [];

  for (const trMatch of trMatches) {
    const tr = trMatch[1];
    // Extract all <td> cell contents (strip inner HTML tags)
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
    );

    if (cells.length < 5) continue; // Skip header/loading rows

    const [externalId, agency, method, type, rawTitle] = cells;

    // Extract href for detail page link (project_id)
    const hrefMatch = tr.match(/href=["']([^"']*project_id=(\d+)[^"']*)['"]/i);
    const projectId = hrefMatch ? hrefMatch[2] : externalId || "";
    const sourceUrl = projectId ? `${DETAIL_BASE}${projectId}` : LIST_URL;

    // Extract clean title text (may include anchor text)
    const titleMatch = tr.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
      : rawTitle;

    if (!title) continue;

    records.push({
      externalId: String(projectId || externalId || "").trim(),
      title,
      agency: agency || undefined,
      description: type ? `ประเภท: ${type} วิธีการ: ${method}` : undefined,
      sourceUrl,
      status: "Public",
      rawData: { externalId, agency, method, type, title },
    });
  }

  return records;
};

/**
 * Fetch public procurement listings from EGAT Bidding portal.
 * Returns normalised records ready for IngestionPipeline.
 */
const fetchListings = async ({ timeoutMs = 30000 } = {}) => {
  const html = await fetchHtml(LIST_URL, { timeoutMs });
  const records = parseRows(html);

  if (!records.length) {
    throw Object.assign(
      new Error("EGAT Bidding: no rows found in the listing table"),
      { code: "SOURCE_NO_ROWS" }
    );
  }

  return { source: SOURCE, sourceUrl: LIST_URL, records };
};

module.exports = {
  SOURCE,
  LIST_URL,
  DETAIL_BASE,
  fetchListings,
  parseRows,
};

