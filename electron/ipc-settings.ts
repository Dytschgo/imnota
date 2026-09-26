import type { WorkspaceSettings } from '../src/shared/types.js';
import { sanitizeFilename } from '../src/shared/utils.js';
import { openCommittedBackupRestore } from './backup-restore-result.js';
import { app, dialog, shell } from 'electron';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';

export function registerSettingsIpc(router: IpcRouter, host: IpcHost): void {
  const { handle } = router;
  const {
    assertProjectPath,
    contentSearch,
    diagnostics,
    openWithRecovery,
    persistApplicationSettings,
    withSnapshotWarnings,
  } = host;
  handle('settings:get', () => host.settings);
  handle('diagnostics:open-folder', async () => {
    diagnostics.retryStorage();
    if (
      !(await diagnostics.record({ category: 'lifecycle', action: 'diagnostics-check', phase: 'observed' }))
    )
      throw new Error(
        'Local diagnostics could not be written. Check free space and application data folder access.',
      );
    const error = await shell.openPath(await diagnostics.openDirectory());
    if (error) throw new Error('The diagnostics folder could not be opened.');
  });
  handle('settings:choose-workspace', async () => {
    const result = await dialog.showOpenDialog(host.mainWindow!, {
      title: 'Choose Imnota workspace',
      defaultPath: host.settings.workspacePath || app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    contentSearch.invalidate();
    host.settings.workspacePath = result.filePaths[0];
    await persistApplicationSettings(host.settings);
    return host.settings;
  });
  handle('settings:set', async (_event, input: Partial<WorkspaceSettings>) => {
    const next = { ...host.settings, ...input };
    const persist = async () => {
      await persistApplicationSettings(next);
    };
    if (next.updateChannel !== host.settings.updateChannel)
      await host.updateController.switchChannel(next.updateChannel, persist);
    else await persist();
    return host.settings;
  });
  handle('backups:list', () => host.backupService!.listSnapshots());
  handle('backups:choose-location', async () => {
    const result = await dialog.showOpenDialog(host.mainWindow!, {
      title: 'Choose local history location',
      properties: ['openDirectory', 'createDirectory'],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle('backups:create', async (_event, input) => {
    const safePath = await assertProjectPath(input.projectPath);
    return host.backupService!.createSnapshot(safePath, 'manual');
  });
  handle('backups:inspect', (_event, input) => host.backupService!.inspectSnapshot(input.snapshotId));
  handle('backups:export', async (_event, input) => {
    const inspection = await host.backupService!.inspectSnapshot(input.snapshotId);
    const result = await dialog.showSaveDialog(host.mainWindow!, {
      title: 'Export backup archive',
      defaultPath: `${sanitizeFilename(inspection.summary.sourceProjectName, 'imnota-backup')} ${inspection.summary.createdAt.slice(0, 10)}.imnota-backup.zip`,
      filters: [{ name: 'Imnota backup archive', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) return { cancelled: true };
    await host.backupService!.exportSnapshot(input.snapshotId, result.filePath);
    return { cancelled: false, filePath: result.filePath };
  });
  handle('backups:restore', async (_event, input) => {
    if (input.mode === 'new') {
      const restored = await host.backupService!.restoreNew(input.snapshotId);
      const warnings = restored.warnings ?? [];
      return openCommittedBackupRestore(
        { mode: 'new', projectPath: restored.projectPath, warnings },
        async (projectPath) => withSnapshotWarnings(await openWithRecovery(projectPath), warnings),
      );
    }
    const safePath = await assertProjectPath(input.projectPath);
    const inspection = await host.backupService!.inspectSnapshot(input.snapshotId);
    const smokeApproved = process.env.IMNOTA_SMOKE === '1' && host.smokeBackupRestorePath === safePath;
    host.smokeBackupRestorePath = null;
    const answer = smokeApproved
      ? { response: 1 }
      : await dialog.showMessageBox(host.mainWindow!, {
          type: 'warning',
          buttons: ['Cancel', 'Restore in place'],
          defaultId: 0,
          cancelId: 0,
          message: `Replace ${inspection.summary.sourceProjectName} with this snapshot?`,
          detail:
            'Imnota will create a safety snapshot first. The selected historical files then replace the current project in its existing folder.',
        });
    if (answer.response !== 1) throw new Error('Restore in place cancelled.');
    host.projectWatchManager?.stopProject(safePath);
    const restored = await host.backupService!.restoreInPlace(input.snapshotId, safePath);
    const warnings = [
      `The full pre-restore project remains recoverable at ${restored.rollbackPath}.`,
      ...(restored.warnings ?? []),
    ];
    return openCommittedBackupRestore(
      {
        mode: 'in-place',
        projectPath: restored.projectPath,
        safetySnapshotId: restored.safetySnapshotId,
        rollbackPath: restored.rollbackPath,
        warnings,
      },
      async (projectPath) => withSnapshotWarnings(await openWithRecovery(projectPath), warnings),
    );
  });
}
