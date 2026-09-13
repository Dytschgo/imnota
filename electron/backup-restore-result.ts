import type { BackupRestoreResult } from '../src/shared/backups.js';
import type { ProjectSnapshot } from '../src/shared/types.js';

interface CommittedRestore {
  mode: BackupRestoreResult['mode'];
  projectPath: string;
  safetySnapshotId?: string;
  rollbackPath?: string;
  warnings?: string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function openCommittedBackupRestore(
  committed: CommittedRestore,
  openProject: (projectPath: string) => Promise<ProjectSnapshot>,
): Promise<BackupRestoreResult> {
  try {
    return {
      ...committed,
      snapshot: await openProject(committed.projectPath),
    };
  } catch (error) {
    const openError = errorMessage(error);
    return {
      ...committed,
      openError,
      warnings: committed.warnings ?? [],
    };
  }
}
