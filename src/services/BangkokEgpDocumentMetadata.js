// The official API sometimes omits masterAnnounceTypeName. Preserve the
// filename's status evidence rather than treating a winner notice as a TOR.
const CANCEL_PATTERN = /ยกเลิก/;
const AWARD_PATTERN = /ผลผู้|ผู้ชนะ|ผู้เสนอราคาที่ได้รับ/;
const TOR_PATTERN = /TOR|ขอบเขต|ประกวดราคา|เอกสารซื้อหรือจ้าง|เชิญชวน/i;

function announcementLabel(row) {
  const type = String(row.masterAnnounceTypeName || "").trim();
  let filename = String(row.projectAnnouncementPath || row.projectAnnouncementRssLink || "");
  try { filename = decodeURIComponent(filename); } catch { /* Retain malformed literal filenames for review. */ }
  // A terminal filename wins even if an inconsistent generic type was supplied.
  if (CANCEL_PATTERN.test(filename) || AWARD_PATTERN.test(filename)) return filename;
  return type || filename;
}

function announcementPriority(type) {
  if (/ร่าง/.test(type)) return 2;
  return /เชิญชวน|ประกาศประกวดราคา/.test(type) ? 0 : 1;
}

function detailTerminalStatus(detail = {}) {
  const name = String(detail.sourceStatus || detail.masterContractAvailableName || "");
  const code = detail.sourceStatusCode || detail.masterContractAvailableCode;
  if (code === "S5" || CANCEL_PATTERN.test(name)) return "cancelled";
  if (code === "C04" || /ส่งงานครบถ้วน/.test(name)) return "closed";
  // C01 and this label were verified on real official project-detail responses.
  if (code === "C01" || /จัดทำสัญญา|ลงนาม.*สัญญา/.test(name)) return "awarded";
  return null;
}

module.exports = { announcementLabel, announcementPriority, detailTerminalStatus, CANCEL_PATTERN, AWARD_PATTERN, TOR_PATTERN };
