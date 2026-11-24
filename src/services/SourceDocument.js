// Serves one PDF out of a source ZIP archive (Tero bundles every TOR file in one ZIP).
// Downloads are restricted to TOR_ALLOWED_HOSTS and 15 MiB by TorSource.download.
const { download } = require("./TorSource");
const { archiveEntry, readEntry } = require("./TeroDocumentArchive");

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_BYTES = 60 * 1024 * 1024;
const MAX_CONCURRENT_DOWNLOADS = 4;

const cache = new Map(); // url -> { bytes, expires }
const inFlight = new Map(); // url -> Promise<Buffer>
let cachedBytes = 0;
let downloads = 0;

const busyError = () => Object.assign(new Error("Too many document downloads in progress"), { code: "BUSY" });

function remember(url, bytes) {
  if (bytes.length > CACHE_MAX_BYTES) return;
  cache.set(url, { bytes, expires: Date.now() + CACHE_TTL_MS });
  cachedBytes += bytes.length;
  // Map iteration is insertion order, so the oldest entries go first.
  for (const [key, entry] of cache) {
    if (cachedBytes <= CACHE_MAX_BYTES) break;
    cache.delete(key);
    cachedBytes -= entry.bytes.length;
  }
}

function cached(url) {
  const entry = cache.get(url);
  if (!entry) return null;
  if (entry.expires > Date.now()) return entry.bytes;
  cache.delete(url);
  cachedBytes -= entry.bytes.length;
  return null;
}

// Resolves to { fileName, bytes } for an archived PDF URL, or null when the URL is not one.
async function archivedPdf(documentUrl, { fetchImpl = fetch } = {}) {
  const entry = archiveEntry(documentUrl);
  if (!entry) return null;
  const key = `${entry.archiveUrl}#${entry.fileName}`;
  const hit = cached(key);
  if (hit) return { fileName: entry.fileName, bytes: hit };
  if (!inFlight.has(key)) {
    if (downloads >= MAX_CONCURRENT_DOWNLOADS) throw busyError();
    downloads += 1;
    inFlight.set(key, (async () => {
      try {
        const archive = await download(entry.archiveUrl, 0, fetchImpl);
        const bytes = await readEntry(archive.bytes, entry.fileName);
        remember(key, bytes);
        return bytes;
      } finally {
        downloads -= 1;
        inFlight.delete(key);
      }
    })());
  }
  return { fileName: entry.fileName, bytes: await inFlight.get(key) };
}

// RFC 6266 filename: an ASCII fallback plus the exact UTF-8 name.
function contentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function clearCache() { cache.clear(); cachedBytes = 0; }

module.exports = { archivedPdf, contentDisposition, clearCache };
