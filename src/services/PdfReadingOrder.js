// Some invitations append colored date fields after the body in the PDF's
// content stream. Reconstruct horizontal reading order from rendered positions.
// Keep exact text matching: coordinates change ordering, never add characters.
function readingOrder(items) {
  const lines = [];
  for (const item of items) {
    if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue;
    const [a, b, c, d, x, y] = item.transform;
    if (![a, b, c, d, x, y].every(Number.isFinite) || Math.abs(b) > 0.1 || Math.abs(c) > 0.1) return null;
    let line = lines.find(line => Math.abs(line.y - y) <= 2);
    if (!line) { line = { y, items: [] }; lines.push(line); }
    line.items.push({ x, text: item.str });
  }
  return lines.sort((a, b) => b.y - a.y).map(line => line.items.sort((a, b) => a.x - b.x).map(i => i.text).join(' ')).join('\n');
}
module.exports = { readingOrder };
