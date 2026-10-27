const cheerio = require("cheerio");
const { analysisError } = require("./AnalysisErrors");
const ORIGIN = "https://egp2.bangkok.go.th";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_ANALYSIS_BYTES = 20 * 1024 * 1024;

function checkedUrl(value) {
  const url = new URL(value);
  const hosts = (process.env.TOR_ALLOWED_HOSTS || "egp2.bangkok.go.th,adminapiegp.bangkok.go.th,bidding.egat.co.th,process.gprocurement.go.th,process3.gprocurement.go.th,process5.gprocurement.go.th")
    .split(",").map(s => s.trim().toLowerCase());
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !hosts.includes(url.hostname)) {
    throw analysisError("UNSUPPORTED_DOCUMENT", "TOR URL must use HTTPS on a configured TOR_ALLOWED_HOSTS host");
  }
  return url;
}

async function download(value, redirects = 0) {
  const url = checkedUrl(value);
  const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(30000) });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    if (redirects >= 3 || !response.headers.get("location")) throw new Error("Invalid TOR redirect");
    return download(new URL(response.headers.get("location"), url).href, redirects + 1);
  }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`TOR source HTTP ${response.status}`); }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw analysisError("DOCUMENT_LIMIT", "TOR document exceeds 15 MiB");
    chunks.push(chunk);
  }
  return { url: url.href, bytes: Buffer.concat(chunks) };
}

function attachmentUrl(id, path) {
  if (/^https?:\/\//i.test(path)) return path;
  if (path.startsWith("Uploads")) return `https://adminapiegp.bangkok.go.th/${path}`;
  return `${ORIGIN}/api/file/${encodeURIComponent(id)}/${encodeURIComponent(path)}`;
}

async function readJson(url) {
  return JSON.parse((await download(url)).bytes.toString("utf8"));
}

async function loadTor(sourceUrl, knownDocuments = []) {
  const source = checkedUrl(sourceUrl.replace(/^http:/i, "https:"));
  let urls = [];
  const detail = source.pathname.match(/^\/project-detail\/([^/]+)\/?$/);
  if (source.origin === ORIGIN && detail) {
    const query = `?pageNo=1&pageSize=100&projectId=${encodeURIComponent(detail[1])}`;
    const tors = await readJson(`${ORIGIN}/appapi/api/ProjectTors/GetTorInProject${query}`);
    if (tors.hasNextPage) throw new Error("Too many TOR records; manual document selection required");
    const torUrls = (tors.data || []).filter(row => row.projectTorPath)
      .map(row => attachmentUrl(row.projectTorId || row.id, row.projectTorPath));
    // Publication and submission dates often exist only in the invitation PDF.
    {
      const announcements = await readJson(`${ORIGIN}/appapi/api/ProjectAnnouncements/GetAnnouncementDetailInProject${query}`);
      if (announcements.hasNextPage) throw new Error("Too many announcements; manual selection required");
      urls = (announcements.data || [])
        .filter(row => /TOR|ขอบเขต|ประกวดราคา|เอกสารซื้อหรือจ้าง|เชิญชวน/i.test(row.masterAnnounceTypeName || ""))
        .filter(row => !/ยกเลิก|ผู้ชนะ|ผลผู้/.test(row.masterAnnounceTypeName || ""))
        .filter(row => row.projectAnnouncementRssLink || row.projectAnnouncementPath)
        .sort((a, b) => {
          const priority = row => /ประกาศเชิญชวน/.test(row.masterAnnounceTypeName || "") ? 0 : /ร่าง/.test(row.masterAnnounceTypeName || "") ? 2 : 1;
          return priority(a) - priority(b) || new Date(b.projectAnnouncementPublishDate) - new Date(a.projectAnnouncementPublishDate);
        })
        .map(row => attachmentUrl(row.id, row.projectAnnouncementRssLink || row.projectAnnouncementPath));
    }
    urls.push(...torUrls);
  } else {
    urls = [...new Set(knownDocuments.filter(d => ["tor", "announcement"].includes(d.kind) && d.url).map(d => d.url.replace(/^http:/i, "https:")))];
    if (!urls.length) urls = [source.href];
  }
  urls = [...new Set(urls)].slice(0, 5);
  if (!urls.length) throw analysisError("NO_TOR_DOCUMENT", "No public TOR attachment found at sourceUrl");
  const documents = [];
  let analysisBytes = 0;
  for (const url of urls) {
    const document = await download(url);
    if (document.bytes.subarray(0, 5).toString() === "%PDF-") {
      if (analysisBytes + document.bytes.length <= MAX_ANALYSIS_BYTES) {
        documents.push(document);
        analysisBytes += document.bytes.length;
      }
    } else {
      const $ = cheerio.load(document.bytes.toString("utf8"));
      const links = [...new Set($("a[href]").map((_, el) => {
        const href = $(el).attr("href");
        return /\.pdf(?:[?#]|$)/i.test(href) ? new URL(href, document.url).href : null;
      }).get().filter(Boolean))];
      if (!links.length) throw analysisError("NO_TOR_DOCUMENT", "Source returned HTML without a PDF TOR attachment");
      if (links.length + documents.length > 5) throw new Error("Too many PDF attachments");
      for (const link of links) {
        const pdf = await download(link);
        if (pdf.bytes.subarray(0, 5).toString() !== "%PDF-") throw new Error("Attachment is not a PDF");
        if (analysisBytes + pdf.bytes.length <= MAX_ANALYSIS_BYTES) {
          documents.push(pdf);
          analysisBytes += pdf.bytes.length;
        }
      }
    }
  }
  if (!documents.length) throw analysisError("DOCUMENT_LIMIT", "No TOR PDF fits within analysis limits");
  return documents;
}

module.exports = { loadTor, checkedUrl, attachmentUrl };
