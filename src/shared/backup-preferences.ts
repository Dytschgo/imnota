// Backup preference defaults. Kept free of zod so renderer preferences can use them without
// loading the backup schemas; `./backups.js` re-exports both for the main process.

export interface BackupPreferences {
  enabled: boolean;
  location: string;
  retentionCount: number;
  retentionAgeDays: number;
}

export const DEFAULT_BACKUP_PREFERENCES: BackupPreferences = {
  enabled: false,
  location: '',
  retentionCount: 20,
  retentionAgeDays: 90,
};
