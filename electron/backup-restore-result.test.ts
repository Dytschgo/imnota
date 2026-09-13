// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSnapshot } from '../src/shared/types.js';
import { openCommittedBackupRestore } from './backup-restore-result.js';

describe('openCommittedBackupRestore', () => {
  it('returns committed paths and a retryable open error instead of reporting restore failure', async () => {
    const open = vi.fn(async () => {
      throw new Error('injected reopen failure');
    });
    const result = await openCommittedBackupRestore(
      {
        mode: 'in-place',
        projectPath: 'C:\\workspace\\project',
        safetySnapshotId: 'safety',
        rollbackPath: 'C:\\workspace\\.imnota-restore-rollback-safe',
        warnings: ['retention pending'],
      },
      open,
    );

    expect(result).toMatchObject({
      mode: 'in-place',
      projectPath: 'C:\\workspace\\project',
      safetySnapshotId: 'safety',
      rollbackPath: 'C:\\workspace\\.imnota-restore-rollback-safe',
      openError: 'injected reopen failure',
    });
    expect(result.snapshot).toBeUndefined();
    expect(result.warnings).toEqual(['retention pending']);
    expect(open).toHaveBeenCalledOnce();
  });

  it('attaches the authoritative snapshot when reopening succeeds', async () => {
    const snapshot = { projectPath: 'C:\\workspace\\restored' } as ProjectSnapshot;
    await expect(
      openCommittedBackupRestore({ mode: 'new', projectPath: snapshot.projectPath }, async () => snapshot),
    ).resolves.toMatchObject({ mode: 'new', projectPath: snapshot.projectPath, snapshot });
  });
});
