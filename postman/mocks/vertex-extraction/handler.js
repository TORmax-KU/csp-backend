const http = require('http');
// Google generateContent envelope; fixture content is deliberately synthetic.
http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'POST' || !req.url.endsWith('/publishers/google/models/test-model:generateContent')) {
    res.writeHead(501); return res.end(JSON.stringify({ error: 'Endpoint not modeled' }));
  }
  const body = req.body;
  if (!body?.contents?.[0]?.parts?.some(p => p.inlineData?.mimeType === 'application/pdf') || !body?.generationConfig?.responseSchema?.properties?.metadata || !body.systemInstruction) {
    res.writeHead(400); return res.end(JSON.stringify({ error: { code: 400, message: 'Missing PDF, system instruction or metadata schema', status: 'INVALID_ARGUMENT' } }));
  }
  if (req.headers['x-test-error'] === '429') {
    res.writeHead(429); return res.end(JSON.stringify({ error: { code: 429, message: 'Resource exhausted', status: 'RESOURCE_EXHAUSTED' } }));
  }
  const date = { status: 'not_found', reason: 'ไม่พบวันที่ในเอกสาร', evidence: null, day: null, month: null, year: null, calendar: null, time: null };
  const value = { hasTorContent: true, descriptions: 'สรุป TOR สำหรับการทดสอบการเชื่อมต่อ', mandatorySkills: [], skillEvidence: [], noMandatorySkillsReason: 'ไม่มีทักษะที่ระบุชัดเจน', metadata: {
    budget: { status: 'found', reason: '', amountTHB: 2330000, evidence: { quote: 'งบประมาณ 2,330,000 บาท (สองล้านสามแสนสามหมื่นบาทถ้วน)', page: 6, documentIndex: 1 } }, announcedAt: date, deadline: date,
  } };
  res.end(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: JSON.stringify(value) }] }, finishReason: 'STOP' }] }));
}).listen(process.env.PORT || 4500);
