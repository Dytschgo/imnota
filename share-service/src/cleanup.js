import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { cleanupExpired, reconcileArtifacts } from './maintenance.js';

const config = loadConfig();
const db = openDatabase(config);
try {
  const result = await cleanupExpired({ db, config });
  const reconciliation = await reconcileArtifacts({ db, config });
  console.log(JSON.stringify({ ...result, ...reconciliation }));
  if (result.failedShares > 0) process.exitCode = 1;
} finally {
  db.close();
}
