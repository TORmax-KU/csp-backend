const { attachmentUrl, checkedUrl } = require("./TorSource");

const ORIGIN = "https://egp2.bangkok.go.th";
const API_BASE = `${ORIGIN}/appapi/api`;

// Announcement type names observed on the Bangkok e-GP portal
const CANCEL_PATTERN = /ยกเลิก/;
const AWARD_PATTERN = /ผลผู้|ผู้ชนะ|ผู้เสนอราคาที่ได้รับ/;
const TOR_PATTERN = /TOR|ขอบเขต|ประกวดราคา|เอกสารซื้อหรือจ้าง|เชิญชวน/i;

const fetchJson = async (url, fetchImpl = fetch) => {
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "TORmax-public-aggregator/2.0" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Bangkok EGP detail API returned HTTP ${response.status}`);
  return response.json();
};

const fetchProjectDetail = async (projectId, { fetchImpl } = {}) => {
  const url = `${API_BASE}/Projects/GetProjectDetail?projectId=${encodeURIComponent(projectId)}`;
  const detail = await fetchJson(url, fetchImpl);
  if (!detail || typeof detail !== "object" || !detail.projectId) {
    throw new Error("Bangkok EGP detail response missing project data");
  }
  return {
    projectId: detail.projectId,
    sourceStatus: detail.masterContractAvailableName || detail.masterContractAvailableCode || "",
    procurementMethod: detail.masterMethodIdName || "",
    goodsCategory: detail.masterGoodsIdName || "",
    procurementType: detail.masterTypeIdName || "",
    referencePrice: typeof detail.projectAverageBudget === "number" ? detail.projectAverageBudget : undefined,
    rawData: detail,
  };
};

const fetchAnnouncements = async (projectId, { fetchImpl } = {}) => {
  const url = `${API_BASE}/ProjectAnnouncements/GetAnnouncementDetailInProject?pageNo=1&pageSize=100&projectId=${encodeURIComponent(projectId)}`;
  const payload = await fetchJson(url, fetchImpl);
  if (payload?.hasNextPage) throw new Error("Too many announcements; manual selection required");
  return (payload?.data || []).map((row) => ({
    id: row.id,
    type: String(row.masterAnnounceTypeName || "").trim(),
    publishDate: row.projectAnnouncementPublishDate || null,
    url: (row.projectAnnouncementRssLink || row.projectAnnouncementPath)
      ? attachmentUrl(row.id, row.projectAnnouncementRssLink || row.projectAnnouncementPath)
      : null,
  }));
};

const deriveProcurementStatus = (announcements) => {
  const sorted = [...announcements].sort(
    (a, b) => new Date(a.publishDate) - new Date(b.publishDate)
  );
  const latestTerminal = [...sorted].reverse().find(
    (a) => CANCEL_PATTERN.test(a.type) || AWARD_PATTERN.test(a.type)
  );
  if (latestTerminal) return CANCEL_PATTERN.test(latestTerminal.type) ? "cancelled" : "awarded";
  if (announcements.some((a) => TOR_PATTERN.test(a.type))) return "open";
  return "unknown";
};

// Terminal announcements are status evidence, not TOR documents
const toTorDocuments = (announcements) =>
  announcements
    .filter((a) => a.url && TOR_PATTERN.test(a.type))
    .filter((a) => !CANCEL_PATTERN.test(a.type) && !AWARD_PATTERN.test(a.type))
    .map((a) => ({ title: a.type, url: a.url, kind: "tor" }));

// Reads only the first chunk so large PDFs are not fully downloaded
const verifyPdfUrl = async (url, { fetchImpl = fetch } = {}) => {
  const checked = checkedUrl(url);
  const response = await fetchImpl(checked.href, {
    headers: { "user-agent": "TORmax-public-aggregator/2.0", range: "bytes=0-63" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) return false;
  const reader = response.body.getReader();
  try {
    const { value } = await reader.read();
    const bytes = value ? Buffer.from(value) : Buffer.alloc(0);
    return bytes.subarray(0, 5).toString() === "%PDF-";
  } finally {
    await reader.cancel().catch(() => {});
  }
};

module.exports = {
  ORIGIN,
  API_BASE,
  fetchProjectDetail,
  fetchAnnouncements,
  deriveProcurementStatus,
  toTorDocuments,
  verifyPdfUrl,
};
