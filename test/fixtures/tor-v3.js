const absentDate = () => ({ status: "not_found", reason: "ไม่พบวันที่ในเอกสาร", evidence: null, day: null, month: null, year: null, calendar: null, time: null });
const metadata = () => ({ budget: { status: "not_found", reason: "ไม่พบวงเงินงบประมาณ", evidence: null, amountTHB: null }, announcedAt: absentDate(), deadline: absentDate() });
const result = () => ({ hasTorContent: true, descriptions: "ดูแลระบบซอฟต์แวร์", mandatorySkills: [], skillEvidence: [], noMandatorySkillsReason: "ไม่มีทักษะที่ระบุชัดเจน", metadata: metadata() });
module.exports = { metadata, result };
