const test = require("node:test");
const assert = require("node:assert/strict");
const { parseRows } = require("../src/services/EgatBiddingClient");

const html = `<table><tbody>
<tr><td>Header</td></tr>
<tr>
  <td>EGAT-001</td>
  <td>EGAT</td>
  <td>e-bidding</td>
  <td>IT</td>
  <td><a href="project/index.php?project_id=123">Supply and install network switches</a></td>
</tr>
</tbody></table>`;

test("EGAT parser extracts project id, title and agency from a row", () => {
  const records = parseRows(html);
  assert.equal(records.length, 1);
  assert.equal(records[0].externalId, "123");
  assert.equal(records[0].title, "Supply and install network switches");
  assert.equal(records[0].agency, "EGAT");
  assert.equal(records[0].sourceUrl, "https://bidding.egat.co.th/procure/project/index.php?project_id=123");
});

test("EGAT parser falls back to the external id column when no title link is present", () => {
  const noLink = html.replace(/<a[^>]*>([\s\S]*?)<\/a>/, "$1");
  const records = parseRows(noLink);
  assert.equal(records.length, 1);
  assert.equal(records[0].externalId, "EGAT-001");
  // No href to extract a numeric project_id from, so the source link falls back
  // to the detail page built from the row's own external id column.
  assert.equal(records[0].sourceUrl, "https://bidding.egat.co.th/procure/project/index.php?project_id=EGAT-001");
});

test("EGAT parser returns nothing when there is no tbody", () => {
  assert.deepEqual(parseRows("<p>no table here</p>"), []);
});
