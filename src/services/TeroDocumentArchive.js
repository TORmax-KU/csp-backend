const yauzl = require('yauzl');
const { analysisError } = require('./AnalysisErrors');
const MAX_TOTAL = 20 * 1024 * 1024;
const MAX_FILE = 15 * 1024 * 1024;
function priority(name) {
  if (/annoudoc_[^/]+\.pdf$/i.test(name)) return 0;
  if (/(?:attach[_ -]?tor|ขอบเขต|รายละเอียดคุณลักษณะ|(?:^|[/_ -])tor[_ .-])/i.test(name) && /\.pdf$/i.test(name)) return 1;
  if (/(?:^|\/)doc_[^/]+\.pdf$/i.test(name)) return 2;
  return 99;
}
// Read entries in memory; never extract provider-controlled paths to disk.
function readArchive(bytes, archiveUrl) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, autoClose: false, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(analysisError('UNSUPPORTED_DOCUMENT', 'Invalid Tero ZIP archive'));
      const entries = [];
      let count = 0, declared = 0, actual = 0, finished = false;
      const fail = error => { if (!finished) { finished = true; zip.close(); reject(error); } };
      zip.on('error', () => fail(analysisError('UNSUPPORTED_DOCUMENT', 'Invalid ZIP contents')));
      zip.on('entry', entry => {
        if (++count > 200 || (declared += entry.uncompressedSize) > 100 * 1024 * 1024 || entry.generalPurposeBitFlag & 1) {
          return fail(analysisError('DOCUMENT_LIMIT', 'ZIP entry count, expanded size or encryption exceeds limits'));
        }
        if (priority(entry.fileName) < 99) entries.push(entry);
        zip.readEntry();
      });
      zip.on('end', async () => {
        try {
          const selected = entries.sort((a, b) => priority(a.fileName) - priority(b.fileName)).slice(0, 5);
          const documents = [];
          for (const entry of selected) {
            if (entry.uncompressedSize > MAX_FILE || actual + entry.uncompressedSize > MAX_TOTAL) throw analysisError('DOCUMENT_LIMIT', 'Selected TOR PDFs exceed analysis size limits');
            const data = await new Promise((resolveFile, rejectFile) => {
              zip.openReadStream(entry, (error, stream) => {
                if (error) return rejectFile(error);
                const chunks = []; let length = 0;
                stream.on('data', chunk => {
                  length += chunk.length;
                  if (length > MAX_FILE || actual + length > MAX_TOTAL) stream.destroy(new Error('ZIP expansion exceeds limits'));
                  else chunks.push(chunk);
                });
                stream.on('error', rejectFile); stream.on('end', () => resolveFile(Buffer.concat(chunks)));
              });
            });
            if (data.subarray(0, 5).toString() !== '%PDF-') throw analysisError('UNSUPPORTED_DOCUMENT', 'Selected ZIP entry is not a PDF');
            actual += data.length;
            documents.push({ url: `${archiveUrl}#file=${encodeURIComponent(entry.fileName)}`, bytes: data,
              title: entry.fileName, kind: priority(entry.fileName) === 0 ? 'announcement' : 'tor' });
          }
          if (!documents.some(d => d.kind === 'tor')) throw analysisError('NO_TOR_DOCUMENT', 'Archive contains no identifiable TOR or tender PDF');
          if (!finished) { finished = true; zip.close(); resolve(documents); }
        } catch (error) { fail(error); }
      });
      zip.readEntry();
    });
  });
}
module.exports = { readArchive, priority };
