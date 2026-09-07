import { createService } from './app.js';
import { cleanupExpired, reconcileArtifacts } from './maintenance.js';
import { backupMetadata } from './metadata-backup.js';

const service = createService();
await reconcileArtifacts({ db: service.db, config: service.config, aggressive: true });
await backupMetadata({ db: service.db, config: service.config });
const server = service.app.listen(service.config.port, () => {
  console.log(`Imnota share service listening on port ${service.config.port}`);
});

const cleanupTimer = setInterval(() => {
  cleanupExpired({ db: service.db, config: service.config })
    .then(async (result) => {
      const reconciliation = await reconcileArtifacts({ db: service.db, config: service.config });
      if (
        result.deletedShares ||
        result.failedShares ||
        result.deletedPairings ||
        reconciliation.deletedDirectories ||
        reconciliation.deletedReservations
      ) {
        console.log('Cleanup:', { ...result, ...reconciliation });
      }
    })
    .catch((error) => console.error('Scheduled cleanup failed:', error));
}, service.config.cleanupIntervalMs);
cleanupTimer.unref();

const backupTimer = setInterval(() => {
  backupMetadata({ db: service.db, config: service.config })
    .then((result) => console.log('Metadata backup:', result))
    .catch((error) => console.error('Scheduled metadata backup failed:', error));
}, service.config.backupIntervalMs);
backupTimer.unref();

function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  clearInterval(cleanupTimer);
  clearInterval(backupTimer);
  server.close(() => {
    service.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
