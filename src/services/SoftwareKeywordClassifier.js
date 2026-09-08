const FILTER_VERSION = "software-keywords-v1";

const POSITIVE_KEYWORDS = [
  "software",
  "application",
  "web application",
  "mobile application",
  "website",
  "system development",
  "information technology",
  "database",
  "cloud",
  "cybersecurity",
  "ซอฟต์แวร์",
  "โปรแกรม",
  "แอปพลิเคชัน",
  "เว็บไซต์",
  "พัฒนาระบบ",
  "ระบบสารสนเทศ",
  "เทคโนโลยีสารสนเทศ",
  "ฐานข้อมูล",
  "ระบบคลาวด์",
  "ความปลอดภัยไซเบอร์",
];

const HARDWARE_ONLY_KEYWORDS = [
  "computer hardware",
  "printer",
  "monitor",
  "เครื่องคอมพิวเตอร์",
  "เครื่องพิมพ์",
  "อุปกรณ์คอมพิวเตอร์",
  "วัสดุคอมพิวเตอร์",
];

const normalizeText = (value) => String(value || "")
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[\u200B-\u200D\uFEFF]/g, "")
  .replace(/\s+/g, " ")
  .trim();

const classifySoftware = (record) => {
  const text = normalizeText([
    record.title,
    record.description,
    record.category,
    record.scope,
    record.rawText,
  ].filter(Boolean).join(" "));

  const matchedKeywords = POSITIVE_KEYWORDS.filter((keyword) =>
    text.includes(normalizeText(keyword))
  );
  const hardwareOnlyMatches = HARDWARE_ONLY_KEYWORDS.filter((keyword) =>
    text.includes(normalizeText(keyword))
  );

  return {
    isSoftware: matchedKeywords.length > 0,
    matchedKeywords,
    hardwareOnlyMatches,
    filterVersion: FILTER_VERSION,
  };
};

module.exports = {
  FILTER_VERSION,
  POSITIVE_KEYWORDS,
  HARDWARE_ONLY_KEYWORDS,
  normalizeText,
  classifySoftware,
};
