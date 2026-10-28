const { recentWindow, isRecentPublication } = require('./RecentProcurementWindow');
const ORIGIN = 'https://run-procurement.terodigital.com';
const SOURCE = 'tero-procurement';
let publicDevKey;
async function apiKey(fetchImpl, env) {
  if (env.TERO_API_KEY) return env.TERO_API_KEY;
  if (env.TERO_ALLOW_PUBLIC_DEV_KEY !== 'true') throw new Error('Configure TERO_API_KEY (or explicitly enable the documented public development key)');
  if (!publicDevKey) {
    const response = await fetchImpl(`${ORIGIN}/api-docs/procurement`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Tero API documentation HTTP ${response.status}`);
    const text = require('cheerio').load(await response.text()).text();
    publicDevKey = text.match(/Dev key[\s\S]*?([a-f0-9]{64})/i)?.[1];
    if (!publicDevKey) throw new Error('Tero development key unavailable; configure TERO_API_KEY');
  }
  return publicDevKey;
}
function toRecord(row) {
  const id = String(row.project_id || '');
  if (!/^\d{11}$/.test(id) || row.source !== 'gprocurement') return null;
  return { externalId: id, nationalProjectId: id, title: row.project_name,
    agency: row.agency_full || row.agency, sourceStatus: row.status,
    sourceUrl: `${ORIGIN}/announcements/gprocurement/${id}`,
    procurementMethod: row.procurement_method, listingAnnouncedAt: row.announce_date,
    rawData: { tero: row } };
}
async function fetchListings({ fetchImpl = fetch, env = process.env, now = new Date(), keywords = ['ซอฟต์แวร์', 'ระบบสารสนเทศ', 'พัฒนาระบบ', 'เว็บไซต์', 'แอปพลิเคชัน', 'คอมพิวเตอร์', 'เครือข่าย', 'software'] } = {}) {
  const key = await apiKey(fetchImpl, env);
  const { cutoff, dateFrom } = recentWindow(now);
  const records = new Map();
  for (const keyword of keywords) {
    for (let offset = 0; ; offset += 500) {
      const url = new URL(`${ORIGIN}/api/announcements`);
      for (const [k, v] of Object.entries({ keyword, date_from: dateFrom, watchlist: false, ministry_watched: false, limit: 500, offset })) url.searchParams.set(k, v);
      const response = await fetchImpl(url, { headers: { 'X-API-Key': key }, redirect: 'error', signal: AbortSignal.timeout(40000) });
      if (!response.ok) throw new Error(`Tero listing HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.data) || !Number.isFinite(Number(body.meta?.total))) throw new Error('Invalid Tero pagination response');
      for (const row of body.data) {
        if (!isRecentPublication(row.announce_date, cutoff)) continue;
        const record = toRecord(row);
        if (record) records.set(record.externalId, record);
      }
      if (offset + body.data.length >= Number(body.meta.total)) break;
      if (!body.data.length || offset >= 9500) throw new Error('Tero pagination incomplete; refusing a partial import');
    }
  }
  return { source: SOURCE, sourceUrl: `${ORIGIN}/announcements`, records: [...records.values()] };
}
module.exports = { fetchListings, toRecord, SOURCE, ORIGIN };
