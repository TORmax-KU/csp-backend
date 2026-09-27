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

test("does not classify a hardware-only TOR as software", () => {
  const result = classifySoftware({ title: "ซื้อเครื่องคอมพิวเตอร์และเครื่องพิมพ์" });

  assert.equal(result.isSoftware, false);
  assert.ok(result.hardwareOnlyMatches.includes("เครื่องคอมพิวเตอร์"));
});
