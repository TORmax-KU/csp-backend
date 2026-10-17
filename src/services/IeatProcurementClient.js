/**
 * IeatProcurementClient.js
 *
 * Scraper for https://iprocurement.ieat.go.th/news
 *
 * Approach: The page is a server-rendered CodeIgniter app that renders news
 * items directly in the HTML using class names like:
 *   .nw-body  — project title
 *   .nw-meta  — e-GP project number (เลขที่โครงการ e-GP: Pxxxxxxxx)
 *   .nw-act   — link to gprocurement.go.th with the original announcement
 *
 * Each tab (แผนการจัดซื้อจัดจ้าง / ประกาศเชิญชวน / ร่างเอกสาร / ราคากลาง / ผู้ชนะ / ยกเลิก)
 * is rendered in the same page. We extract all .nw-body+.nw-meta pairs regardless of tab.
 *
 * Pagination: client-side JS (.nw-pager). All items for the current view are
 * embedded in the HTML on load, so a single HTTP GET captures the full first-render set.
 */

const SOURCE = "ieat-procurement";
const NEWS_URL = "https://iprocurement.ieat.go.th/news";

const fetchHtml = async (url, { timeoutMs = 30000 } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "TORmax-public-aggregator/1.0",
        Accept: "text/html,application/xhtml+xml,*/*",
        "Accept-Language": "th,en;q=0.5",
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`IEAT Procurement returned HTTP ${res.status}`);
    return res.text();
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Parse a Thai short-date string (e.g. "15  ต.ค." or "15 ต.ค. 2569") into
 * an ISO date string.  Year defaults to the current Buddhist year when absent.
 */
const THAI_MONTHS = {
  "ม.ค.": "01", "ก.พ.": "02", "มี.ค.": "03", "เม.ย.": "04",
  "พ.ค.": "05", "มิ.ย.": "06", "ก.ค.": "07", "ส.ค.": "08",
  "ก.ย.": "09", "ต.ค.": "10", "พ.ย.": "11", "ธ.ค.": "12",
};

const parseThaiDate = (raw) => {
  const str = String(raw || "").replace(/\s+/g, " ").trim();
  const m = str.match(/(\d{1,2})\s+(\S+\.?)(?:\s+(\d{4}))?/);
  if (!m) return undefined;
  const [, day, mon, buddhistYear] = m;
  const monthNum = THAI_MONTHS[mon];
  if (!monthNum) return undefined;
  const buddhistNow = new Date().getFullYear() + 543;
  const year = buddhistYear ? Number(buddhistYear) - 543 : buddhistNow - 543;
  return `${year}-${monthNum}-${String(day).padStart(2, "0")}`;
};

/**
 * Extract all procurement items from the rendered IEAT HTML.
 */
const parseItems = (html) => {
  // Build a list of { date, title, meta, href } from the nw-item / nw-list groups
  // Structure example:
  //   <div class="nw-item ...">
  //     <div class="nw-date">15  ต.ค.</div>
  //     <div class="nw-body"> TITLE \n META </div>
  //     <div class="nw-act"><a href="http://process.gprocurement...">เปิดแผน</a></div>
  //   </div>

  const records = [];

  // Match every nw-body div
  const bodyRe = /<div[^>]+class=["'][^"']*nw-body[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  const metaRe = /<div[^>]+class=["'][^"']*nw-meta[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  const dateRe = /<(?:div|span|time)[^>]+class=["'][^"']*nw-date[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|time)>/gi;
  const actRe = /<div[^>]+class=["'][^"']*nw-act[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;

  // Collect all occurrences
  const bodies = [...html.matchAll(bodyRe)];
  const metas = [...html.matchAll(metaRe)];
  const dates = [...html.matchAll(dateRe)];
  const acts = [...html.matchAll(actRe)];

  const stripHtml = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  for (let i = 0; i < bodies.length; i++) {
    const rawBody = stripHtml(bodies[i][1]);
    // The .nw-body div may contain both the title and the meta text as child nodes.
    // Strip any trailing "เลขที่โครงการ e-GP: Pxxxxxx" suffix that leaked in.
    const cleanBody = rawBody.replace(/\s*เลขที่โครงการ\s*e-GP\s*:\s*P\d+.*$/i, "").trim();
    const bodyLines = cleanBody.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const title = bodyLines[0] || cleanBody;

    // Extract meta: เลขที่โครงการ e-GP: Pxxxxxxxxx
    const rawMeta = metas[i] ? stripHtml(metas[i][1]) : rawBody;
    const projectIdMatch = rawMeta.match(/P\d{11,}/);
    const externalId = projectIdMatch ? projectIdMatch[0] : `ieat-${i}`;

    // Source URL from act href
    let sourceUrl = NEWS_URL;
    if (acts[i]) {
      const hrefMatch = acts[i][1].match(/href=["']([^"']+)['"]/i);
      if (hrefMatch) sourceUrl = hrefMatch[1].replace(/&amp;/g, "&");
    }

    // Date
    const rawDate = dates[i] ? stripHtml(dates[i][1]) : "";
    const deadline = parseThaiDate(rawDate) || undefined;

    if (!title) continue;

    records.push({
      externalId,
      title,
      agency: "กนอ. (IEAT)",
      description: rawMeta,
      deadline,
      sourceUrl,
      status: "Public",
      rawData: { externalId, title, meta: rawMeta, date: rawDate },
    });
  }

  return records;
};

/**
 * Fetch the IEAT procurement news page and return normalised records.
 */
const fetchListings = async ({ timeoutMs = 30000 } = {}) => {
  const html = await fetchHtml(NEWS_URL, { timeoutMs });
  const records = parseItems(html);

  if (!records.length) {
    throw Object.assign(
      new Error("IEAT Procurement: no items found on news page"),
      { code: "SOURCE_NO_ROWS" }
    );
  }

  return { source: SOURCE, sourceUrl: NEWS_URL, records };
};

module.exports = {
  SOURCE,
  NEWS_URL,
  fetchListings,
  parseItems,
  parseThaiDate,
};
