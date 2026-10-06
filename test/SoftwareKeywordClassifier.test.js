const test = require("node:test");
const assert = require("node:assert/strict");

const { classifySoftware } = require("../src/services/SoftwareKeywordClassifier");

test("classifies a Thai software TOR", () => {
  const result = classifySoftware({
    title: "ประกวดราคาจ้างบำรุงรักษาระบบเครือข่ายและโปรแกรมประยุกต์",
  });

  assert.equal(result.isSoftware, true);
  assert.ok(result.matchedKeywords.includes("โปรแกรม"));
});

test("includes computer hardware within the requested technology scope", () => {
  const result = classifySoftware({ title: "ซื้อเครื่องคอมพิวเตอร์และเครื่องพิมพ์" });

  assert.equal(result.isSoftware, true);
  assert.ok(result.hardwareOnlyMatches.includes("เครื่องคอมพิวเตอร์"));
});

test("excludes consumables even when the title contains computer terms", () => {
  for (const title of ['ซื้อกระดาษสำหรับเครื่องคอมพิวเตอร์', 'ซื้อหมึกพิมพ์สำหรับระบบคอมพิวเตอร์', 'Computer printer toner cartridges', 'ซื้อเครื่องเขียน']) {
    assert.equal(classifySoftware({ title }).isSoftware, false, title);
  }
  assert.equal(classifySoftware({ title: 'จ้างบำรุงรักษาระบบเครือข่ายและแม่ข่าย' }).isSoftware, true);
});

test("does not classify an unrelated project as software due to agency name in rawText", () => {
  const record = {
    title: "จ้างทำกล่องกระดาษบรรจุเอกสาร จำนวน 500 ใบ โดยวิธีเฉพาะเจาะจง",
    description: "",
    rawText: JSON.stringify({
      masterOrgDepartmentName: "สำนักงานพัฒนาระบบระบายน้ำ",
    }),
  };

  const result = classifySoftware(record);

  assert.equal(result.isSoftware, false);
  assert.deepEqual(result.matchedKeywords, []);
});
