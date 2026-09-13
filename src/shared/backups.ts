import { z } from 'zod';
import type { ProjectSnapshot } from './types.js';

export const BACKUP_MANIFEST_VERSION = 1 as const;
export const BACKUP_SNAPSHOT_REASONS = [
  'manual',
  'migration',
  'destructive-operation',
  'safety-restore',
] as const;

export type BackupSnapshotReason = (typeof BACKUP_SNAPSHOT_REASONS)[number];

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

export const backupPreferencesSchema = z
  .object({
    enabled: z.boolean(),
    location: z.string().max(2_000),
    retentionCount: z.number().int().min(1).max(500),
    retentionAgeDays: z.number().int().min(1).max(3_650),
  })
  .strict();

export const backupSnapshotIdSchema = z.string().regex(/^snapshot-[0-9]{8}T[0-9]{6}[0-9]{3}Z-[0-9a-f]{32}$/);

export const backupRelativePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .superRefine((value, context) => {
    if (
      value.includes('\0') ||
      value.includes('\\') ||
      value.includes(':') ||
      value.startsWith('/') ||
      value.split('/').some((part) => !part || part === '.' || part === '..')
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Unsafe backup path.' });
  });

export const backupManifestFileSchema = z
  .object({
    path: backupRelativePathSchema,
    size: z.number().int().nonnegative().safe(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export const backupManifestSchema = z
  .object({
    version: z.literal(BACKUP_MANIFEST_VERSION),
    snapshotId: backupSnapshotIdSchema,
    sourceProjectId: z.string().min(1).max(500),
    sourceProjectName: z.string().min(1).max(500),
    createdAt: z.string().datetime(),
    schemaVersion: z.number().int().min(1).max(10_000),
    reason: z.enum(BACKUP_SNAPSHOT_REASONS),
    files: z.array(backupManifestFileSchema).min(1).max(20_000),
    // Legacy migration supplies defaults for these absent sidecars; a backup must not invent them.
    absentLegacySidecars: z
      .array(
        backupRelativePathSchema.refine(
          (value) => /^(?:rounds\/[^/]+\/)?(?:annotations|notes)\/[^/]+$/.test(value),
          'Expected a legacy notes or annotations path.',
        ),
      )
      .min(1)
      .max(20_000)
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    const paths = manifest.files.map((file) => file.path.normalize('NFC').toLowerCase());
    if (new Set(paths).size !== paths.length)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Backup paths are aliased.' });
    if (!paths.includes('project.json'))
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Backup has no project.json.' });
    const absent = (manifest.absentLegacySidecars ?? []).map((value) => value.normalize('NFC').toLowerCase());
    if (new Set([...paths, ...absent]).size !== paths.length + absent.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Absent legacy paths overlap or are aliased.',
      });
    if (manifest.absentLegacySidecars && manifest.schemaVersion !== 1 && manifest.schemaVersion !== 2)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Only legacy projects may omit sidecars.' });
    if (paths.length + absent.length > 20_000)
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Too many authoritative backup paths.' });
  });

export type BackupManifest = z.infer<typeof backupManifestSchema>;

export interface BackupSnapshotSummary {
  snapshotId: string;
  sourceProjectId: string;
  sourceProjectName: string;
  createdAt: string;
  schemaVersion: number;
  reason: BackupSnapshotReason;
  fileCount: number;
  totalSize: number;
  warnings?: string[];
}

export interface InvalidBackupSnapshot {
  entry: string;
  message: string;
}

export interface BackupListResult {
  location: string;
  snapshots: BackupSnapshotSummary[];
  invalid: InvalidBackupSnapshot[];
  recoveryMessages?: string[];
}

export interface BackupInspection {
  summary: BackupSnapshotSummary;
  manifest: BackupManifest;
}

export interface BackupExportResult {
  cancelled: boolean;
  filePath?: string;
}

export interface BackupRestoreResult {
  mode: 'new' | 'in-place';
  projectPath: string;
  snapshot?: ProjectSnapshot;
  safetySnapshotId?: string;
  rollbackPath?: string;
  warnings?: string[];
  openError?: string;
}

export const createBackupInputSchema = z.object({ projectPath: z.string().min(1).max(2_000) }).strict();
export const inspectBackupInputSchema = z.object({ snapshotId: backupSnapshotIdSchema }).strict();
export const restoreBackupInputSchema = z.discriminatedUnion('mode', [
  z.object({ snapshotId: backupSnapshotIdSchema, mode: z.literal('new') }).strict(),
  z
    .object({
      snapshotId: backupSnapshotIdSchema,
      mode: z.literal('in-place'),
      projectPath: z.string().min(1).max(2_000),
      confirmation: z.literal('RESTORE'),
    })
    .strict(),
]);

export interface BackupBridge {
  getBackupHistory(): Promise<BackupListResult>;
  chooseBackupLocation(): Promise<string | null>;
  createBackupSnapshot(input: { projectPath: string }): Promise<BackupSnapshotSummary>;
  inspectBackupSnapshot(input: { snapshotId: string }): Promise<BackupInspection>;
  exportBackupSnapshot(input: { snapshotId: string }): Promise<BackupExportResult>;
  restoreBackupSnapshot(
    input:
      | { snapshotId: string; mode: 'new' }
      | { snapshotId: string; mode: 'in-place'; projectPath: string; confirmation: 'RESTORE' },
  ): Promise<BackupRestoreResult>;
}
