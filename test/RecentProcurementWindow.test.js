const test = require('node:test');
const assert = require('node:assert/strict');
const { recentWindow, isRecentPublication } = require('../src/services/RecentProcurementWindow');
test('two calendar months includes the boundary Bangkok day and future publications', () => {
  const window = recentWindow(new Date('2026-10-28T11:00:00+07:00'));
  assert.equal(window.dateFrom, '2026-08-28');
  assert.equal(isRecentPublication('2026-08-27T17:00:00Z', window.cutoff), true);
  assert.equal(isRecentPublication('2026-08-27T16:59:59Z', window.cutoff), false);
  assert.equal(isRecentPublication('2027-01-01', window.cutoff), true);
  assert.equal(isRecentPublication(null, window.cutoff), false);
  assert.equal(isRecentPublication('28 ส.ค. 69', window.cutoff), true);
  assert.equal(isRecentPublication('27 ส.ค. 69', window.cutoff), false);
  assert.equal(isRecentPublication('29 ส.ค. 68', window.cutoff), false);
  assert.equal(isRecentPublication('-', window.cutoff), false);
  assert.equal(recentWindow(new Date('2026-04-30T20:00:00Z')).dateFrom, '2026-03-01');
  assert.equal(recentWindow(new Date('2026-04-30T11:00:00Z')).dateFrom, '2026-02-28');
});
