import { createService } from './app.js';
import { cleanupExpired } from './maintenance.js';

const service = createService();
const server = service.app.listen(service.config.port, () => {
  console.log(`Imnota share service listening on port ${service.config.port}`);
});

const cleanupTimer = setInterval(() => {
  cleanupExpired({ db: service.db, config: service.config })
    .then((result) => {
      if (result.deletedShares || result.failedShares || result.deletedPairings)
        console.log('Cleanup:', result);
    })
    .catch((error) => console.error('Scheduled cleanup failed:', error));
}, service.config.cleanupIntervalMs);
cleanupTimer.unref();

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  clearInterval(cleanupTimer);
  server.close(() => {
    service.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
