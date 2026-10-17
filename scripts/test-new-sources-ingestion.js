require('dotenv').config();
const mongoose = require('mongoose');
const { runEgatBiddingIngestion, runIeatIngestion, runGistdaIngestion } = require('../src/services/RunMultiSourceIngestion');
const Project = require('../src/models/Project');
const IngestionLog = require('../src/models/IngestionLog');

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/tormax_dev';
  console.log('Connecting to database:', uri);
  await mongoose.connect(uri);
  console.log('Database connected.');

  console.log('\n--- 1. Testing EGAT Ingestion ---');
  try {
    const egatLog = await runEgatBiddingIngestion();
    console.log('EGAT result:', {
      status: egatLog.status,
      created: egatLog.projectsCreated,
      updated: egatLog.projectsUpdated,
      filtered: egatLog.projectsFiltered,
      skipped: egatLog.projectsSkipped,
    });
  } catch (err) {
    console.error('EGAT error:', err.message);
  }

  console.log('\n--- 2. Testing GISTDA Ingestion (limited to 2 pages for quick test) ---');
  try {
    const gistdaLog = await runGistdaIngestion({ maxPages: 2, perPage: 10 });
    console.log('GISTDA result:', {
      status: gistdaLog.status,
      created: gistdaLog.projectsCreated,
      updated: gistdaLog.projectsUpdated,
      filtered: gistdaLog.projectsFiltered,
      skipped: gistdaLog.projectsSkipped,
    });
  } catch (err) {
    console.error('GISTDA error:', err.message);
  }

  console.log('\n--- 3. Testing IEAT Ingestion ---');
  try {
    const ieatLog = await runIeatIngestion();
    console.log('IEAT result:', {
      status: ieatLog.status,
      created: ieatLog.projectsCreated,
      updated: ieatLog.projectsUpdated,
      filtered: ieatLog.projectsFiltered,
      skipped: ieatLog.projectsSkipped,
    });
  } catch (err) {
    console.error('IEAT error:', err.message);
  }

  console.log('\n--- 4. Checking Ingested Software Projects in DB ---');
  const sources = ['egat-bidding', 'ieat-procurement', 'gistda-procurement'];
  for (const src of sources) {
    const count = await Project.countDocuments({ source: src });
    const sample = await Project.find({ source: src }).limit(2).select('title externalId source category classification matchedKeywords');
    console.log(`\nSource [${src}] total in DB: ${count}`);
    if (sample.length) {
      console.log('Samples:', JSON.stringify(sample, null, 2));
    }
  }

  await mongoose.disconnect();
  console.log('\nDone.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

