const { recentWindow, isRecentPublication } = require('./RecentProcurementWindow');
const SOURCE = 'govspending';
const ENDPOINT = 'https://opend.data.go.th/govspending/service/egp-contract';
function toRecord(row) {
  const id = String(row.project_id || '');
  if (!/^\d{11}$/.test(id)) return null;
  // Store only documented public fields. The response's request object can echo the key.
  const safe = Object.fromEntries(['project_id', 'project_name', 'announce_date', 'project_money', 'price_build', 'project_status', 'dept_name', 'dept_sub_name', 'purchase_method_name', 'year'].map(k => [k, row[k]]));
  const contracted = Array.isArray(row.contract) ? row.contract.length > 0 : !!row.contract?.contract_date;
  return { externalId: id, nationalProjectId: id, title: row.project_name,
    agency: row.dept_sub_name || row.dept_name,
    sourceStatus: contracted ? 'awarded' : String(row.project_status || 'unknown'),
    procurementMethod: row.purchase_method_name, listingAnnouncedAt: row.announce_date,
    // Document resolution is independently verified through Tero; never persist an authenticated API URL.
    sourceUrl: `https://run-procurement.terodigital.com/announcements/gprocurement/${id}`,
    rawData: { govspending: { ...safe, hasContract: contracted, endpoint: ENDPOINT } } };
}
async function fetchListings({ fetchImpl = fetch, env = process.env, now = new Date(), keywords = ['ซอฟต์แวร์', 'ระบบสารสนเทศ', 'พัฒนาระบบ', 'เว็บไซต์', 'แอปพลิเคชัน', 'software'], onProgress = () => {} } = {}) {
  if (!env.GOVSPENDING_API_KEY) throw new Error('Configure GOVSPENDING_API_KEY in the backend .env');
  const { cutoff } = recentWindow(now);
  const fiscal = date => { const local = new Date(date.getTime() + 7 * 3600000); return local.getUTCFullYear() + 543 + (local.getUTCMonth() >= 9 ? 1 : 0); };
  // Query fiscal years intersecting the rolling window. Future fiscal years
  // enter this set as time advances; the provider errors on unavailable years.
  const years = [...new Set([fiscal(cutoff), fiscal(now)])];
  const records = new Map();
  for (const year of years) for (const keyword of keywords) {
    for (let offset = 0; ; offset += 1000) {
      const url = new URL(ENDPOINT);
      for (const [k, v] of Object.entries({ 'api-key': env.GOVSPENDING_API_KEY, year, keyword, limit: 1000, offset })) url.searchParams.set(k, v);
      let response;
      try { response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(40000) }); }
      catch { throw new Error('GovSpending request failed or timed out'); }
      if (!response.ok) throw new Error(`GovSpending HTTP ${response.status}`);
      const body = await response.json();
      if (body.success === false) throw new Error('GovSpending rejected the request');
      if (!Array.isArray(body.data)) throw new Error('Invalid GovSpending response data');
      onProgress({ source: SOURCE, year, keyword, offset, count: body.data.length, total: body.total });
      for (const row of body.data) {
        if (!isRecentPublication(row.announce_date, cutoff)) continue;
        const record = toRecord(row); if (record) records.set(record.externalId, record);
      }
      if (body.data.length < 1000 || (Number.isFinite(Number(body.total)) && offset + body.data.length >= Number(body.total))) break;
      if (offset >= 49000) throw new Error('GovSpending pagination limit reached; import incomplete');
    }
  }
  return { source: SOURCE, sourceUrl: ENDPOINT, records: [...records.values()] };
}
module.exports = { fetchListings, toRecord, SOURCE, ENDPOINT };
