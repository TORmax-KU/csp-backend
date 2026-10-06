// Retained as a compatibility guard for old callers. This source is retired.
async function runBangkokEgpIngestion() {
  throw new Error("Bangkok e-GP ingestion has been retired. Use national e-GP ingestion.");
}
module.exports = { runBangkokEgpIngestion };
