require('dotenv').config();
const http = require('http');
const app = require('./app');
const { initSocket } = require('./config/socket');
const { startWorkers, stopWorkers } = require('./workers/startWorkers')
const db = require('./db');

const PORT = process.env.PORT || 3001;
const server = http.createServer(app);
const ioInstance = initSocket(server); 

// ─── Start ───
async function startServer() {
    // Verify DB connection
    await db.raw('SELECT 1');
    console.log('✓ Database connected');

    // Start pg-boss and register all workers
    await startWorkers();
    console.log('✓ pg-boss and workers initialized.');

    //Start HTTP server
    server.listen(PORT, () => {
      console.log(`✓ Server running on port ${PORT}`);
    });
 
};

// Graceful shutdown
const shutdown = async () => {
  console.log('SIGTERM signal received: Shutting down HTTP server...');
  server.close(async () => {
    console.log('HTTP server closed. Stopping pg-boss workers...');
    await stopWorkers();
    if (ioInstance) {
      console.log('Stopping Socket.IO server...');
      await ioInstance.close(); 
      console.log('✓ Socket.IO server stopped.');
    }
    await db.destroy();
    console.log('All services stopped. Exiting.');
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
