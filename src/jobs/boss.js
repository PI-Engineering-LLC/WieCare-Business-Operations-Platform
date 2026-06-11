const {PgBoss} = require('pg-boss')
// const PgBoss = require('pg-boss');

let bossInstance = null;
let bossReadyPromise = null; // Stores the promise that resolves when boss is fully ready

async function initializeAndStartBoss() {
  if (!bossReadyPromise) {
    // Only perform the initialization and start sequence once
    bossReadyPromise = (async () => {
     // const databaseUrl = `${process.env.DB_PROTOCOL}://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`;
     const databaseUrl =`${process.env.DATABASE_URL}`      
      bossInstance = new PgBoss({
        connectionString: databaseUrl,
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInHours: 24,
        archiveCompletedAfterSeconds: 86400,
        deleteAfterDays: 7,
        max: 10,
      });

      bossInstance.on('error', (err) => console.error('pg-boss error:', err));
      console.log('TRACE: PgBoss instance created.');

      console.log('TRACE: Attempting to start PgBoss instance...');
      // By awaiting .start(), pg-boss connects to the DB and runs migrations.
      await bossInstance.start(); 
      console.log('TRACE: PgBoss instance started successfully.');

      return bossInstance;
    })();
  }
  
  // Always return the same promise so callers await the exact same startup sequence
  return bossReadyPromise; 
}

function getBossInstance() {
  if (!bossInstance) {
    console.warn('PgBoss instance requested before initialization. Ensure initializeAndStartBoss() is called at startup.');
  }
  return bossInstance;
}

module.exports = {
  initializeAndStartBoss,
  getBossInstance
};
