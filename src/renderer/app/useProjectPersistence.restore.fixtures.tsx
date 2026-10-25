import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ImnotaBridge, ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type { WorkflowBridge, ProjectWatchEvent } from '../../shared/workflow-bridge';
import { emptyProject } from '../../shared/utils';
import { ContentPersistenceService } from '../../../electron/content-persistence';
import { contentItemRelativePaths } from '../../../electron/content-paths';
import { registerScreenshotIpc } from '../../../electron/ipc-screenshots';
import { ProjectWatchManager, projectRevisionForSource } from '../../../electron/project-watch';
import { writeApplicationFile } from '../../../electron/application-persistence';
import { PersistenceDiagnostics } from '../../../electron/persistence-diagnostics';
import { WorkspaceContentSearch } from '../../../electron/content-search';
import { workflowOutcome } from '../../../electron/workflow-errors';
import type { IpcHost } from '../../../electron/main';
import type { IpcRouter } from '../../../electron/ipc-router';
import {
  persistenceSession,
  persistenceFault,
  trackWatch,
  type PersistenceLedger,
} from '../../test/persistence-ledger';
import { useProjectPersistence } from './useProjectPersistence';

export const platform = process.platform;
export const session = persistenceSession();
export const { ledger, it } = session;
beforeEach(session.start);
// Real candidate writes, fsync and rename. Windows substitutes only POSIX directory handles.
export function fault(target: string, code: string) {
  return persistenceFault(ledger(), target, 'directory', code, { requireDirectory: true });
}

export function fixture(
  kind: 'screenshot' | 'text' | 'drawing',
  options: { holdWatchEvents?: boolean } = {},
) {
  const owner = ledger();
  return owner.span('fixture construction', () => buildFixture(owner, kind, options));
}

async function buildFixture(
  ledger: PersistenceLedger,
  kind: 'screenshot' | 'text' | 'drawing',
  options: { holdWatchEvents?: boolean },
) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-restore-')));
  ledger.own(root, 'imnota-restore-');
  const projectPath = path.join(root, 'project');
  await fs.mkdir(projectPath);
  const projectFile = path.join(projectPath, 'project.json');
  const initial = emptyProject('Restore', '');
  const shot: ScreenshotRecord = {
    id: 'shot_restore',
    collectionId: initial.collections[0].id,
    originalFilename: 'restore.png',
    storedFilename: 'restore.png',
    title: 'Restore',
    description: 'Exact description',
    position: 0,
    createdAt: initial.createdAt,
    updatedAt: initial.updatedAt,
    priority: 'medium',
    annotationFile: 'collections/001-collection/annotations/restore.png.json',
    descriptionFile: 'collections/001-collection/descriptions/restore.png.md',
    originalWidth: 1,
    originalHeight: 1,
    includeInExport: true,
  };
  initial.screenshots = [shot];
  const imagePath = `collections/${shot.collectionId}/screenshots/${shot.storedFilename}`;
  await ledger.span('initial files creation', async () => {
    for (const [file, source] of [
      [imagePath, 'synthetic PNG bytes'],
      [shot.annotationFile, '[]'],
      [shot.descriptionFile, shot.description],
    ]) {
      await fs.mkdir(path.dirname(path.join(projectPath, file)), { recursive: true });
      await fs.writeFile(path.join(projectPath, file), source);
    }
    await fs.writeFile(projectFile, JSON.stringify(initial, null, 2));
  });
  const readProject = async (): Promise<ProjectData> => JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const snapshot = vi.fn(async (): Promise<ProjectSnapshot> => {
    const source = await fs.readFile(projectFile);
    return {
      projectPath,
      project: JSON.parse(source.toString()),
      projectRevision: projectRevisionForSource(source),
      thumbnails: {},
      recoveryFound: false,
    };
  });
  let manager: ProjectWatchManager | undefined = undefined;
  const search = new WorkspaceContentSearch();
  const invalidated = vi.fn((target: string) => search.invalidatePath(target));
  const published = vi.fn((file: string, source: string | Uint8Array) =>
    manager?.recordSelfWrite(file, source),
  );
  const diagnostics = new PersistenceDiagnostics(() => path.join(root, 'diagnostics'), {
    version: 'test',
    platform,
  });
  ledger.diagnostics(diagnostics);
  const write = vi.fn((file: string, source: string | Uint8Array) =>
    ledger.span('write', () =>
      writeApplicationFile(file, source, {
        diagnostics,
        recordSelfWrite: published,
        invalidate: invalidated,
      }),
    ),
  );
  const operations = {
    write,
    unlink: async (file: string) => {
      await fs.unlink(file);
      manager?.recordSelfDelete(file);
    },
    removeDirectory: (file: string) => fs.rm(file, { recursive: true, force: true }),
  };
  const service = new ContentPersistenceService({
    snapshot,
    trashItem: operations.unlink,
    transactionOperations: operations,
    trashOperations: operations,
    ownsRestoreRevision: (target, revision) => manager?.hasSelfProjectRevision(target, revision) ?? false,
  });
  let itemId = shot.id;
  let members = [imagePath, shot.annotationFile, shot.descriptionFile];
  if (kind !== 'screenshot') {
    const created = await ledger.span('initial content creation', () =>
      service.create({ projectPath, collectionId: shot.collectionId, kind }),
    );
    const item = created.project.contentItems![0];
    itemId = item.id;
    members = Object.values(contentItemRelativePaths(item));
    if (kind === 'text') await fs.writeFile(path.join(projectPath, members[0]), '# Exact restored Markdown');
  }
  const bytes = await Promise.all(members.map((file) => fs.readFile(path.join(projectPath, file))));
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: never) => Promise<unknown>>();
  registerScreenshotIpc(
    {
      handle: (name: string, handler: (event: IpcMainInvokeEvent, input: never) => Promise<unknown>) =>
        handlers.set(name, handler),
    } as unknown as IpcRouter,
    {
      assertProjectPath: async () => projectPath,
      readProject,
      screenshotTrashOperations: operations,
      makeSnapshot: snapshot,
      diagnostics,
      withSnapshotWarnings: (s: ProjectSnapshot, warnings: string[]) => ({ ...s, warnings }),
      get projectWatchManager() {
        return manager;
      },
    } as unknown as IpcHost,
  );
  const call = <T,>(name: string, input: unknown) =>
    handlers.get(name)!({} as IpcMainInvokeEvent, input as never) as Promise<T>;
  const deleted = await ledger.span('initial content deletion', async () =>
    kind === 'screenshot'
      ? await call<Awaited<ReturnType<ImnotaBridge['deleteScreenshot']>>>('screenshots:delete', {
          projectPath,
          screenshotId: itemId,
        })
      : await service.delete({ projectPath, itemId }),
  );
  const journal = path.join(
    projectPath,
    kind === 'screenshot' ? '.imnota-undo' : '.imnota-content-undo',
    deleted.undoToken,
  );
  const source = await snapshot();
  const events: ProjectWatchEvent[] = [];
  const heldEvents: ProjectWatchEvent[] = [];
  const listeners = new Set<(event: ProjectWatchEvent) => void>();
  // Hold only renderer delivery: native watching, revision reads and writes stay real.
  const deliverWatchEvents = () => {
    for (const event of heldEvents.splice(0)) listeners.forEach((listener) => listener(event));
  };
  const watchedReads = vi.fn(async (target: string) =>
    ledger.span('watch read', () => fs.readFile(target).catch(() => null)),
  );
  manager = new ProjectWatchManager({
    readWatchedFile: watchedReads,
    loadSnapshot: snapshot,
    saveProject: async (_target, project) => {
      await write(projectFile, JSON.stringify(project, null, 2));
      return snapshot();
    },
    emit: (event) => {
      events.push(event);
      if (options.holdWatchEvents) heldEvents.push(event);
      else listeners.forEach((listener) => listener(event));
    },
  });
  const watch = manager;
  trackWatch(ledger, watch);
  ledger.stop(() => watch.stopAll());
  const bridge = {
    startProjectWatch: async () =>
      ledger.span('watch start', () => workflowOutcome(() => watch.start(projectPath))),
    stopProjectWatch: async ({ watchId }) => workflowOutcome(() => watch.stop(watchId)),
    onProjectWatchEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reloadWatchedProject: vi.fn<WorkflowBridge['reloadWatchedProject']>(async ({ watchId }) =>
      ledger.span('watch reload', () => workflowOutcome(() => watch.reload(watchId))),
    ),
    saveProjectCompareAndSwap: vi.fn<WorkflowBridge['saveProjectCompareAndSwap']>(async (input) =>
      ledger.span('CAS', () =>
        workflowOutcome(() => watch.compareAndSwap(input.watchId, input.expectedRevision, input.project)),
      ),
    ),
  } satisfies Partial<WorkflowBridge>;
  window.imnota = bridge as unknown as ImnotaBridge;
  const onSnapshot = vi.fn();
  const selected = vi.fn();
  const hook = renderHook(() =>
    useProjectPersistence({
      snapshot: source,
      activeScreenshot: null,
      onProject: vi.fn(),
      onSnapshot,
      onSelectScreenshot: selected,
    }),
  );
  await waitFor(() => expect(hook.result.current.projectRevision).toBe(source.projectRevision));
  const restore = vi.fn(() =>
    ledger.span('Restore', () =>
      ledger.checkFault(projectFile, () =>
        kind === 'screenshot'
          ? call<ProjectSnapshot>('screenshots:undo-delete', { projectPath, undoToken: deleted.undoToken })
          : service.undoDelete({ projectPath, undoToken: deleted.undoToken }),
      ),
    ),
  );
  published.mockClear();
  invalidated.mockClear();
  onSnapshot.mockClear();
  return {
    write,
    operations,
    search,
    root,
    watchedReads,
    projectPath,
    projectFile,
    readProject,
    source,
    snapshot,
    members,
    bytes,
    itemId,
    journal,
    events,
    deliverWatchEvents,
    published,
    invalidated,
    bridge,
    hook,
    onSnapshot,
    selected,
    restore,
    createContent: (contentKind: 'text' | 'drawing') =>
      service.create({ projectPath, collectionId: shot.collectionId, kind: contentKind }),
  };
}

export const kinds = ['screenshot', 'text', 'drawing'] as const;
const codes = ['EIO', 'EACCES', 'EPERM'];
export const cases = kinds.flatMap((kind) => codes.map((code) => ({ kind, code })));
