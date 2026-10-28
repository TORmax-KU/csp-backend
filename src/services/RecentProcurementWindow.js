// Rolling calendar months, using Bangkok publication days (not insertion time).
function recentWindow(now = new Date(), months = 2) {
  const local = new Date(now.getTime() + 7 * 3600000);
  const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(local.getUTCDate(), lastDay));
  const dateFrom = first.toISOString().slice(0, 10);
  return { dateFrom, cutoff: new Date(`${dateFrom}T00:00:00+07:00`) };
}
function isRecentPublication(value, cutoff) {
  const date = publicationDate(value);
  return value != null && Number.isFinite(date.getTime()) && date >= cutoff;
}
function publicationDate(value) {
  const text = String(value || '').replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - 0x0e50)).trim();
  const match = text.match(/^(\d{1,2})\s+([^\s]+)\s+(\d{2}|\d{4})$/);
  if (match) {
    const months = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];
    const month = months.indexOf(match[2].replace(/\./g, '')) + 1;
    let year = Number(match[3]); if (year < 100) year += 2500; if (year > 2400) year -= 543;
    if (!month) return new Date(NaN);
    const iso = `${year}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    const result = new Date(`${iso}T00:00:00+07:00`);
    if (new Date(result.getTime() + 7 * 3600000).toISOString().slice(0, 10) !== iso) return new Date(NaN);
    return result;
  }
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T00:00:00+07:00` : text);
}
module.exports = { recentWindow, isRecentPublication, publicationDate };
