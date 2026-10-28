function budgetYear(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return Number(parts.find(p => p.type === 'year').value) + 543 + (Number(parts.find(p => p.type === 'month').value) >= 10 ? 1 : 0);
}
module.exports = { budgetYear };
