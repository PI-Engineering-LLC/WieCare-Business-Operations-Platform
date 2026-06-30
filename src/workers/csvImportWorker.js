const readline = require('readline');
const axios = require('axios');
const db = require('../db');
const { parse } = require('csv-parse');
const { getSignedUrl } = require('../storage');

const BATCH_SIZE = 500;

async function insertBatch(rows, stats) {

  if (rows.length === 0) return;
  try {

    const inserted = await db('parts')
      .insert(rows)
      .onConflict('part_number')
      .ignore()
      .returning('part_number');

    // processedCount += inserted.length;
    stats.processedCount += inserted.length;

  } catch (err) {
    console.log('Bad rows:', err)

    if (rows.length === 1) {

      console.error(
        'Bad row:',
        rows[0],
        err.message,
        err.code, rows.length
      );

      stats.failedCount++;
      return;
    }

    const middle = Math.floor(rows.length / 2);

    await insertBatch(rows.slice(0, middle));

    await insertBatch(rows.slice(middle));
  }
}
const processCsvImport = async (jobOrJobs) => {
  // Safe extraction: if it's an array, grab index 0. Otherwise, use it as-is.
  const job = Array.isArray(jobOrJobs) ? jobOrJobs[0] : jobOrJobs;
  // Guard clause just in case the batch is somehow empty
  if (!job || !job.data) {
    console.error("Worker received an empty or invalid job batch.");
    return;
  }
  console.log('TRACE: process csv job running .');
  const { importId } = job.data;
  const importJob = await db('imports').where({ id: importId }).first();

  await db('imports').where({ id: importId }).update({ status: 'processing', processed_rows: 0, failed_rows: 0 });

  // Stream from R2
  const signedUrl = await getSignedUrl(importJob.file_url, 3600, process.env.S3_PRIVATE_BUCKET);
  const { data: stream } = await axios.get(signedUrl, { responseType: 'stream' });

  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity
  });
  let batch = [];
  const stats = {
    processedCount: 0,
    failedCount: 0,
    skippedCount: 0
  };
  let isHeader = true;

  for await (const line of rl) {
    if (isHeader) { isHeader = false; continue; } // Skip the first line
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;
    const cols = [];
    let current = '';
    let inQuotes = false;
    for (let c = 0; c < trimmedLine.length; c++) {
      const ch = trimmedLine[c];
      if (ch === '"') { inQuotes = !inQuotes; }
      else if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; }
      else { current += ch; }
    }
    cols.push(current.trim());

    const itemId = cols[0]?.trim();
    const ezNumber = cols[1]?.trim();
    const name = cols[2]?.trim();
    const extDesc = cols[3]?.trim();
    const basePrice = cols[5]?.trim();

    if (!itemId || name?.includes('*****')) continue;
    const entry = {
      part_number: itemId, 
      ez_number: ezNumber,
      name: name || '',
      description: extDesc ? `${name} - ${extDesc}` : name || '',
      unit_price: parseFloat(basePrice) || 0,
      status: 'active'
    };
    batch.push(entry);
    if (batch.length >= BATCH_SIZE) {
      await insertBatch(batch, stats);
      await db('imports').where({ id: importId }).update({ 
        processed_rows: stats.processedCount,
        failed_rows: stats.failedCount 
      });
      batch = [];

    }

  }

  // Flush remaining rows
  if (batch.length > 0) {
    await insertBatch(batch, stats);
  }

  // Complete
  await db('imports').where({ id: importId }).update({
    status: 'completed',
    processed_rows: stats.processedCount,
    failed_rows: stats.failedCount
  });
  return stats;
};
module.exports = { processCsvImport }