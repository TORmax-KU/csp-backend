const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readArchive } = require('../src/services/TeroDocumentArchive');
const fixture = fs.readFileSync(path.join(__dirname, '../postman/mocks/national-procurement/documents.zip'));
test('untrusted ZIPs enforce declared expansion and encryption limits before reading entries', async () => {
  const oversized = Buffer.from(fixture);
  const directory = oversized.indexOf(Buffer.from('504b0102', 'hex'));
  assert.ok(directory > 0);
  oversized.writeUInt32LE(101 * 1024 * 1024, directory + 24);
  await assert.rejects(readArchive(oversized, 'https://example.test/documents.zip'), { code: 'DOCUMENT_LIMIT' });
  const encrypted = Buffer.from(fixture);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(directory + 8) | 1, directory + 8);
  await assert.rejects(readArchive(encrypted, 'https://example.test/documents.zip'), { code: 'DOCUMENT_LIMIT' });
  await assert.rejects(readArchive(Buffer.from('<html>not ZIP</html>'), 'https://example.test/documents.zip'), { code: 'UNSUPPORTED_DOCUMENT' });
});
