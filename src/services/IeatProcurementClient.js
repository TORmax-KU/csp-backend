const cheerio = require("cheerio");
const { createHash } = require("node:crypto");

const SOURCE = "ieat-procurement";
const NEWS_URL = "https://iprocurement.ieat.go.th/news";

const fetchHtml = async (url, { timeoutMs = 30000 } = {}) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "TORmax-public-aggregator/1.0",
      Accept: "text/html,application/xhtml+xml,*/*",
      "Accept-Language": "th,en;q=0.5",
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`IEAT Procurement returned HTTP ${response.status}`);
  return response.text();
};

const THAI_MONTHS = {
  "ม.ค.": "01", "ก.พ.": "02", "มี.ค.": "03", "เม.ย.": "04",
  "พ.ค.": "05", "มิ.ย.": "06", "ก.ค.": "07", "ส.ค.": "08",
  "ก.ย.": "09", "ต.ค.": "10", "พ.ย.": "11", "ธ.ค.": "12",
};

const parseThaiDate = raw => {
  const match = String(raw || "").replace(/\s+/g, " ").trim().match(/(\d{1,2})\s+(\S+\.?)(?:\s+(\d{4}))?/);
  if (!match || !THAI_MONTHS[match[2]] || !match[3]) return undefined;
  const year = Number(match[3]) >= 2400 ? Number(match[3]) - 543 : Number(match[3]);
  return `${year}-${THAI_MONTHS[match[2]]}-${match[1].padStart(2, "0")}`;
};

// The portal puts plans, invitations, drafts and awards in separate panels.
// Only an actual invitation can have a bid submission deadline.
const parseItems = html => {
  const $ = cheerio.load(html);
  return $(".nw-panel[data-key='invites'] .nw-item").map((_, element) => {
    const item = $(element);
    const title = item.find(".nw-title").first().text().replace(/\s+/g, " ").trim();
    const meta = item.find(".nw-meta").first().text().replace(/\s+/g, " ").trim();
    const href = item.find(".nw-act a[href]").first().attr("href") || item.find(".nw-title[href]").first().attr("href");
    if (!title || !href) return null;
    const sourceUrl = new URL(href, NEWS_URL).href;
    const projectId = meta.match(/(?:[PM])?\d{11,}/i)?.[0] || new URL(sourceUrl).searchParams.get("projectId");
    const externalId = projectId || `ieat-${createHash("sha256").update(sourceUrl).digest("hex").slice(0, 20)}`;
    const published = item.find(".nw-date").first().text().replace(/\s+/g, " ").trim();
    return {
      externalId, title, agency: "กนอ. (IEAT)", description: meta,
      sourceUrl, status: "Public", rawData: { externalId, title, meta, published, category: "invitation" },
    };
  }).get().filter(Boolean);
};

const fetchListings = async ({ timeoutMs = 30000 } = {}) => {
  const records = parseItems(await fetchHtml(NEWS_URL, { timeoutMs }));
  if (!records.length) throw Object.assign(new Error("IEAT Procurement: no invitations found on news page"), { code: "SOURCE_NO_ROWS" });
  return { source: SOURCE, sourceUrl: NEWS_URL, records };
};

module.exports = { SOURCE, NEWS_URL, fetchListings, parseItems, parseThaiDate };
