const http = require('node:http');
const fs = require('node:fs');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (url.pathname === '/api/announcements') {
    if (req.headers['x-api-key'] !== 'simulation-only') return json(401, { message: 'Unauthenticated' });
    if (url.searchParams.get('keyword') === 'error') return json(503, { message: 'Unavailable' });
    return json(200, { data: [
      { source: 'gprocurement', project_id: '69109156238', project_name: 'Software e-bidding', announce_date: '2026-10-25T17:00:00Z', status: 'ระหว่างดำเนินการ', procurement_method: 'e-bidding' },
      { source: 'gprocurement', project_id: '68109156238', project_name: 'Older software', announce_date: '2026-08-27T16:59:59Z' },
    ], meta: { total: 2, count: 2, offset: 0, limit: 500 } });
  }
  if (url.pathname === '/govspending/service/egp-contract') {
    if (url.searchParams.get('api-key') !== 'simulation-only') return json(401, { message: 'No API key found in request' });
    return json(200, { success: true, request: { 'api-key': 'simulation-only' }, data: [{ project_id: '69109156238', project_name: 'Software e-bidding', announce_date: '2026-10-26', project_money: 1100000, purchase_method_name: 'e-bidding', contract: [{ contract_date: '2026-10-27' }] }] });
  }
  if (url.pathname === '/announcements/gprocurement/69109156238/document') {
    res.writeHead(200, { 'content-type': 'application/zip' }); return res.end(fs.readFileSync(require('node:path').join(__dirname, 'documents.zip')));
  }
  json(501, { error: 'Endpoint not modeled' });
}).listen(process.env.PORT || 4511);
