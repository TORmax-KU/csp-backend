const http = require('node:http');
// Shapes/status values observed on the official portal on 2026-10-28.
// IDs and the bare PDF body are deliberately synthetic test fixtures.
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const id = url.searchParams.get('projectId');
  res.setHeader('content-type', 'application/json');
  if (id === 'api-error') { res.writeHead(500); return res.end(JSON.stringify({ error: 'Source failed' })); }
  if (url.pathname.endsWith('/Projects/GetProjectDetail')) {
    return res.end(JSON.stringify({ projectId: id, masterContractAvailableCode: 'C01', masterContractAvailableName: 'จัดทำสัญญา/ PO แล้ว', masterMethodIdName: 'ประกวดราคาอิเล็กทรอนิกส์ (e-bidding)' }));
  }
  if (url.pathname.endsWith('/ProjectTors/GetTorInProject')) return res.end(JSON.stringify({ hasNextPage: false, totalCount: 0, data: [] }));
  if (url.pathname.endsWith('/ProjectAnnouncements/GetAnnouncementDetailInProject')) {
    const filename = id === 'winner' ? 'ประกาศผู้ชนะการเสนอราคาจ้างซ่อมคอมพิวเต_1793170110509.pdf' : 'ขอบเขตของงาน_TOR.pdf';
    return res.end(JSON.stringify({ hasNextPage: false, totalCount: 1, data: [{ id: 'fixture-document', masterAnnounceTypeName: null, projectAnnouncementPath: filename, projectAnnouncementRssLink: '', projectAnnouncementPublishDate: '2026-10-27T17:00:00Z' }] }));
  }
  if (url.pathname.startsWith('/api/file/fixture-document/')) {
    res.setHeader('content-type', 'application/pdf'); return res.end('%PDF-1.7 test transport fixture');
  }
  res.writeHead(501); res.end(JSON.stringify({ error: 'Endpoint not modeled' }));
}).listen(process.env.PORT || 4510);
