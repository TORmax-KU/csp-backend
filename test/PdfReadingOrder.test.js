const test = require('node:test');
const assert = require('node:assert/strict');
const { readingOrder } = require('../src/services/PdfReadingOrder');
test('positioned date insertions retain exact characters in the correct sentence', () => {
  const item = (str, x, y) => ({ str, transform: [12, 0, 0, 12, x, y] });
  const text = readingOrder([item('Bid submission on', 10, 100), item('at 16:00', 200, 100), item('Published on', 10, 80), item('12 November 2569', 100, 100), item('26 October 2569', 110, 80)]);
  assert.equal(text, 'Bid submission on 12 November 2569 at 16:00\nPublished on 26 October 2569');
  assert.ok(!text.includes('13 November'));
  assert.ok(!text.includes('12 October'));
  assert.ok(!text.includes('at 17:00'));
  assert.ok(!text.includes('Published on 12 November'));
  assert.equal(readingOrder([{ str: 'rotated', transform: [0, 12, -12, 0, 10, 100] }]), null);
});
