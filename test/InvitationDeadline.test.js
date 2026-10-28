const test = require('node:test');
const assert = require('node:assert/strict');
const { deadlineFromText } = require('../src/services/InvitationDeadline');
test('preflight recognizes only the final e-bidding submission sentence, not sale or delivery dates', () => {
  const sentence = 'ผู้ยื่นข้อเสนอต้องเสนอราคาทางระบบจัดซื้อจัดจ้างภาครัฐด้วยอิเล็กทรอนิกส์ในวันที่ ๑๒ พฤศจิกายน ๒๕๖๙ ระหว่างเวลา ๑๓.๐๐ น. ถึง ๑๖.๐๐ น.';
  assert.equal(deadlineFromText(sentence, 1, 1).value, '2026-11-12T16:00:00+07:00');
  assert.equal(deadlineFromText(sentence.replace('เสนอราคาทางระบบ', 'ซื้อเอกสารทางระบบ'), 1, 1), null);
  assert.equal(deadlineFromText(sentence.replace('พฤศจิกายน', 'กุมภาพันธ์').replace('๑๒', '๓๑'), 1, 1), null);
  assert.equal(deadlineFromText(sentence.replace('ถึง ๑๖.๐๐ น.', ''), 1, 1), null);
});
