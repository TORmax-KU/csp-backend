const { readingOrder } = require('./PdfReadingOrder');
const { validateMetadata } = require('./TorMetadata');
// This preflight only skips expired bids. It never publishes a project or fills
// the AI-owned fields. Unrecognized/scanned invitations still go through Vertex.
async function expiredInvitation(documents, now = new Date()) {
  require('pdf-parse'); // initializes the Node canvas polyfills used by PDF.js
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [index, document] of documents.entries()) {
    if (document.kind !== 'announcement') continue;
    const task = getDocument({ data: new Uint8Array(document.bytes), verbosity: 0 });
    try {
      const pdf = await task.promise;
      for (let page = 1; page <= Math.min(pdf.numPages, 5); page++) {
        const text = readingOrder((await (await pdf.getPage(page)).getTextContent()).items);
        if (!text) continue;
        const date = deadlineFromText(text, index + 1, page);
        if (date && new Date(date.value) <= now) return date;
      }
    } finally { await task.destroy(); }
  }
  return null;
}
function deadlineFromText(text, documentIndex, page) {
  const digits = text.replace(/[๐-๙]/g, c => String(c.charCodeAt(0) - 0x0e50));
  // Require the official single-day final electronic-submission sentence and
  // both ends of its time interval. No generic date or document-sale matching.
  const match = digits.match(/(ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่\s*(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s*(?:พ\.?\s*ศ\.?\s*)?(\d{4})\s*ระหว่างเวลา\s*(\d{1,2})[.:](\d{2})\s*น\.?\s*ถึง\s*(\d{1,2})[.:](\d{2})\s*น\.?)/);
  if (!match) return null;
  const month = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'].indexOf(match[3]) + 1;
  const missing = { status: 'not_found', reason: 'Preflight checks deadline only', evidence: null };
  const result = validateMetadata({ budget: missing, announcedAt: missing, deadline: {
    status: 'found', reason: 'Explicit single-day final submission interval',
    evidence: { quote: match[1], documentIndex, page }, day: Number(match[2]), month,
    year: Number(match[4]), calendar: Number(match[4]) > 2400 ? 'BE' : 'CE',
    time: `${match[7].padStart(2, '0')}:${match[8]}`,
  } }, documentIndex);
  return result.fields.deadline.status === 'found' ? { value: result.values.deadline, evidence: result.fields.deadline.evidence } : null;
}
module.exports = { expiredInvitation, deadlineFromText };
