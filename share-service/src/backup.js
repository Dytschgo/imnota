import { loadConfig } from './config.js';
import { openDatabase } from './database.js';
import { backupMetadata } from './metadata-backup.js';

const config = loadConfig();
const db = openDatabase(config);
try {
  const result = await backupMetadata({ db, config });
  console.log(JSON.stringify(result));
} finally {
  db.close();
}
