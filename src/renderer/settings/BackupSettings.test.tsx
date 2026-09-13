import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BACKUP_PREFERENCES, type BackupManifest } from '../../shared/backups';
import type { ImnotaBridge, ProjectListItem, ProjectSnapshot } from '../../shared/types';
import { BackupSettings } from './BackupSettings';

const snapshotId = 'snapshot-20260913T120000000Z-00000001000040008000000000000000';
const project = {
  id: 'project_one',
  name: 'Atlas',
  projectPath: 'C:\\workspace\\atlas',
} as ProjectListItem;
const summary = {
  snapshotId,
  sourceProjectId: project.id,
  sourceProjectName: project.name,
  createdAt: '2026-09-13T12:00:00.000Z',
  schemaVersion: 4,
  reason: 'manual' as const,
  fileCount: 2,
  totalSize: 2048,
};
const manifest: BackupManifest = {
  version: 1,
  snapshotId,
  sourceProjectId: project.id,
  sourceProjectName: project.name,
  createdAt: summary.createdAt,
  schemaVersion: 4,
  reason: 'manual',
  files: [
    { path: 'project.json', size: 1024, sha256: 'a'.repeat(64) },
    { path: 'collections/001/text/note.md', size: 1024, sha256: 'b'.repeat(64) },
  ],
};

function bridge(overrides: Partial<ImnotaBridge> = {}): ImnotaBridge {
  return {
    getBackupHistory: vi.fn(async () => ({
      location: 'C:\\Backups\\.imnota-backups',
      snapshots: [summary],
      invalid: [],
    })),
    chooseBackupLocation: vi.fn(async () => null),
    createBackupSnapshot: vi.fn(async () => summary),
    inspectBackupSnapshot: vi.fn(async () => ({ summary, manifest })),
    exportBackupSnapshot: vi.fn(async () => ({ cancelled: false, filePath: 'C:\\export.zip' })),
    restoreBackupSnapshot: vi.fn(async () => ({
      mode: 'new',
      projectPath: 'C:\\workspace\\atlas-restored',
      snapshot: { projectPath: 'C:\\workspace\\atlas-restored' } as ProjectSnapshot,
    })),
    loadProject: vi.fn(async (projectPath: string) => ({ projectPath }) as ProjectSnapshot),
    openPath: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as ImnotaBridge;
}

beforeEach(() => {
  Object.defineProperty(window, 'imnota', { configurable: true, value: bridge() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('BackupSettings', () => {
  it.each(['safety snapshot failed', 'swap failed; original restored'])(
    'restarts the renderer watch after %s',
    async (message) => {
      const onRestoreFailed = vi.fn();
      Object.defineProperty(window, 'imnota', {
        configurable: true,
        value: bridge({
          restoreBackupSnapshot: vi.fn(async () => {
            throw new Error(message);
          }),
        }),
      });
      render(
        <BackupSettings
          value={DEFAULT_BACKUP_PREFERENCES}
          projects={[project]}
          onChange={vi.fn()}
          onRestoreFailed={onRestoreFailed}
        />,
      );
      fireEvent.click(await screen.findByRole('button', { name: /Atlas/ }));
      fireEvent.click(await screen.findByRole('button', { name: 'Restore in place…' }));
      fireEvent.click(screen.getByRole('button', { name: 'Restore in place' }));
      await waitFor(() => expect(onRestoreFailed).toHaveBeenCalledOnce());
      expect(await screen.findByText(message)).toBeVisible();
    },
  );

  it('ignores an out-of-order inspection so restore can only use the latest selected snapshot', async () => {
    const secondId = 'snapshot-20260913T120001000Z-00000002000040008000000000000000';
    const secondSummary = { ...summary, snapshotId: secondId, sourceProjectName: 'Beacon' };
    let resolveFirst!: (value: { summary: typeof summary; manifest: BackupManifest }) => void;
    const firstInspection = new Promise<{ summary: typeof summary; manifest: BackupManifest }>((resolve) => {
      resolveFirst = resolve;
    });
    const inspect = vi.fn(({ snapshotId: requested }: { snapshotId: string }) =>
      requested === snapshotId
        ? firstInspection
        : Promise.resolve({
            summary: secondSummary,
            manifest: {
              ...manifest,
              snapshotId: secondId,
              sourceProjectName: 'Beacon',
            },
          }),
    );
    Object.defineProperty(window, 'imnota', {
      configurable: true,
      value: bridge({
        getBackupHistory: vi.fn(async () => ({
          location: 'C:\\Backups\\.imnota-backups',
          snapshots: [summary, secondSummary],
          invalid: [],
        })),
        inspectBackupSnapshot: inspect,
      }),
    });
    render(<BackupSettings value={DEFAULT_BACKUP_PREFERENCES} projects={[project]} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: /Atlas/ }));
    fireEvent.click(screen.getByRole('button', { name: /Beacon/ }));
    await waitFor(() => expect(document.querySelector('.imnota-history-detail')).toHaveTextContent('Beacon'));
    await act(async () => resolveFirst({ summary, manifest }));
    expect(document.querySelector('.imnota-history-detail')).toHaveTextContent('Beacon');
    expect(document.querySelector('.imnota-history-detail')).not.toHaveTextContent('Atlas');
    fireEvent.click(screen.getByRole('button', { name: 'Restore as new project' }));
    await waitFor(() =>
      expect(window.imnota.restoreBackupSnapshot).toHaveBeenCalledWith({
        snapshotId: secondId,
        mode: 'new',
      }),
    );
  });

  it('keeps automatic history opt-in and exposes validated manual snapshot details', async () => {
    const onChange = vi.fn(async () => undefined);
    const onBeforeAction = vi.fn(async () => true);
    render(
      <BackupSettings
        value={DEFAULT_BACKUP_PREFERENCES}
        projects={[project]}
        onChange={onChange}
        onBeforeAction={onBeforeAction}
      />,
    );
    expect(screen.getByRole('checkbox', { name: /Automatic local history/ })).not.toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /Automatic local history/ }));
    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_BACKUP_PREFERENCES, enabled: true });

    await screen.findByRole('button', { name: /Atlas/ });
    fireEvent.click(screen.getByRole('button', { name: 'Create snapshot' }));
    await waitFor(() =>
      expect(window.imnota.createBackupSnapshot).toHaveBeenCalledWith({
        projectPath: project.projectPath,
      }),
    );
    expect(onBeforeAction).toHaveBeenCalled();
    expect(await screen.findByText('2 validated files')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Restore as new project' })).toBeEnabled();
  });

  it('reports corrupt history separately from an empty result and keeps restore unavailable', async () => {
    Object.defineProperty(window, 'imnota', {
      configurable: true,
      value: bridge({
        getBackupHistory: vi.fn(async () => ({
          location: 'C:\\Backups\\.imnota-backups',
          snapshots: [],
          invalid: [{ entry: 'bad/snapshot', message: 'hash mismatch' }],
        })),
      }),
    });
    render(<BackupSettings value={DEFAULT_BACKUP_PREFERENCES} projects={[project]} onChange={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('1 incomplete or corrupt snapshot');
    expect(screen.getByText('No snapshots yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore as new project' })).not.toBeInTheDocument();
  });

  it('requires an explicit in-place confirmation state and forwards the native confirmation token', async () => {
    const onRestored = vi.fn();
    const restored = {
      mode: 'in-place' as const,
      projectPath: project.projectPath,
      snapshot: { projectPath: project.projectPath } as ProjectSnapshot,
      safetySnapshotId: snapshotId,
      rollbackPath: 'C:\\workspace\\.imnota-restore-rollback-token',
    };
    Object.defineProperty(window, 'imnota', {
      configurable: true,
      value: bridge({ restoreBackupSnapshot: vi.fn(async () => restored) }),
    });
    render(
      <BackupSettings
        value={{ ...DEFAULT_BACKUP_PREFERENCES, enabled: true }}
        projects={[project]}
        onChange={vi.fn()}
        onRestored={onRestored}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Atlas/ }));
    await screen.findByText('2 validated files');
    fireEvent.click(screen.getByRole('button', { name: 'Restore in place…' }));
    expect(screen.getByRole('alert')).toHaveTextContent('safety snapshot');
    fireEvent.click(screen.getByRole('button', { name: 'Restore in place' }));
    await waitFor(() =>
      expect(window.imnota.restoreBackupSnapshot).toHaveBeenCalledWith({
        snapshotId,
        mode: 'in-place',
        projectPath: project.projectPath,
        confirmation: 'RESTORE',
      }),
    );
    expect(onRestored).toHaveBeenCalledWith(restored);
  });

  it('offers retry-open after a committed restore without invoking restore a second time', async () => {
    const projectPath = 'C:\\workspace\\atlas-restored';
    const committed = {
      mode: 'new' as const,
      projectPath,
      openError: 'injected reopen failure',
      warnings: [`Restore committed at ${projectPath}.`],
    };
    const restore = vi.fn(async () => committed);
    const reopened = { projectPath } as ProjectSnapshot;
    const loadProject = vi.fn(async () => reopened);
    const onRestored = vi.fn();
    Object.defineProperty(window, 'imnota', {
      configurable: true,
      value: bridge({ restoreBackupSnapshot: restore, loadProject }),
    });
    render(
      <BackupSettings
        value={DEFAULT_BACKUP_PREFERENCES}
        projects={[project]}
        onChange={vi.fn()}
        onRestored={onRestored}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: /Atlas/ }));
    await screen.findByText('2 validated files');
    fireEvent.click(screen.getByRole('button', { name: 'Restore as new project' }));
    expect(await screen.findByText('Restore completed, but the project did not reopen.')).toBeInTheDocument();
    expect(screen.getByText(`Restored project: ${projectPath}`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry opening project' }));

    await waitFor(() => expect(loadProject).toHaveBeenCalledWith(projectPath));
    expect(restore).toHaveBeenCalledTimes(1);
    expect(onRestored).toHaveBeenNthCalledWith(1, committed);
    expect(onRestored).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ projectPath, snapshot: reopened, openError: undefined }),
    );
  });
});
