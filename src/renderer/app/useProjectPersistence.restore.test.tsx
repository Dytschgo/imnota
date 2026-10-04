import { recoverScreenshotTrashTransactions } from '../../../electron/screenshot-trash';
import { recoverContentTrashTransactions } from '../../../electron/content-trash';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ImnotaBridge, ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type { WorkflowBridge, ProjectWatchEvent } from '../../shared/workflow-bridge';
import { emptyProject } from '../../shared/utils';
import { COMMITTED_WRITE_WARNING } from '../../shared/write-outcome';
import { ContentPersistenceService } from '../../../electron/content-persistence';
import { contentItemRelativePaths } from '../../../electron/content-paths';
import { registerScreenshotIpc } from '../../../electron/ipc-screenshots';
import { ProjectWatchManager, projectRevisionForSource } from '../../../electron/project-watch';
import { writeApplicationFile } from '../../../electron/application-persistence';
import { PersistenceDiagnostics } from '../../../electron/persistence-diagnostics';
import { CommittedWriteError } from '../../../electron/files';
import { WorkspaceContentSearch } from '../../../electron/content-search';
import { workflowOutcome } from '../../../electron/workflow-errors';
import type { IpcHost } from '../../../electron/main';
import type { IpcRouter } from '../../../electron/ipc-router';
import { useProjectPersistence } from './useProjectPersistence';

vi.mock('electron', () => ({ app: {}, shell: { trashItem: (target: string) => fs.unlink(target) } }));
vi.mock('../../../electron/native-clipboard', () => ({ nativeClipboard: {} }));
const platform = process.platform;
const realOpen = fs.open.bind(fs);
const realRename = fs.rename.bind(fs);
const roots: string[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  Object.defineProperty(process, 'platform', { value: platform });
  for (const stop of stops.splice(0)) stop();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(root).startsWith('imnota-restore-')
    )
      throw new Error('Unexpected fixture cleanup');
    await fs.rm(root, { recursive: true, force: true });
  }
});

// Real candidate writes, fsync and rename. Windows substitutes only POSIX directory handles.
function fault(target: string, code: string) {
  if (platform === 'win32') Object.defineProperty(process, 'platform', { value: 'linux' });
  let renamed = false;
  let fired = false;
  vi.spyOn(fs, 'rename').mockImplementation(async (...args) => {
    await realRename(...args);
    if (String(args[1]) === target) renamed = true;
  });
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const name = String(args[0]);
    const directory = args[1] === 'r' && (await fs.stat(name)).isDirectory();
    const handle =
      directory && platform === 'win32'
        ? ({ sync: async () => undefined, close: async () => undefined } as Awaited<
            ReturnType<typeof fs.open>
          >)
        : await realOpen(...args);
    const sync = handle.sync.bind(handle);
    handle.sync = async () => {
      if (!fired && renamed && directory && name === path.dirname(target)) {
        fired = true;
        throw Object.assign(new Error(code), { code });
      }
      await sync();
    };
    return handle;
  });
  return () => expect(fired).toBe(true);
}

async function fixture(kind: 'screenshot' | 'text' | 'drawing') {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-restore-')));
  roots.push(root);
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
  for (const [file, source] of [
    [imagePath, 'synthetic PNG bytes'],
    [shot.annotationFile, '[]'],
    [shot.descriptionFile, shot.description],
  ]) {
    await fs.mkdir(path.dirname(path.join(projectPath, file)), { recursive: true });
    await fs.writeFile(path.join(projectPath, file), source);
  }
  await fs.writeFile(projectFile, JSON.stringify(initial, null, 2));
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
  const write = vi.fn((file: string, source: string | Uint8Array) =>
    writeApplicationFile(file, source, {
      diagnostics,
      recordSelfWrite: published,
      invalidate: invalidated,
    }),
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
    const created = await service.create({ projectPath, collectionId: shot.collectionId, kind });
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
  const deleted =
    kind === 'screenshot'
      ? await call<Awaited<ReturnType<ImnotaBridge['deleteScreenshot']>>>('screenshots:delete', {
          projectPath,
          screenshotId: itemId,
        })
      : await service.delete({ projectPath, itemId });
  const journal = path.join(
    projectPath,
    kind === 'screenshot' ? '.imnota-undo' : '.imnota-content-undo',
    deleted.undoToken,
  );
  const source = await snapshot();
  const events: ProjectWatchEvent[] = [];
  const listeners = new Set<(event: ProjectWatchEvent) => void>();
  const watchedReads = vi.fn(async (target: string) => fs.readFile(target).catch(() => null));
  manager = new ProjectWatchManager({
    readWatchedFile: watchedReads,
    loadSnapshot: snapshot,
    saveProject: async (_target, project) => {
      await write(projectFile, JSON.stringify(project, null, 2));
      return snapshot();
    },
    emit: (event) => {
      events.push(event);
      listeners.forEach((listener) => listener(event));
    },
  });
  const watch = manager;
  stops.push(() => watch.stopAll());
  const bridge = {
    startProjectWatch: async () => workflowOutcome(() => watch.start(projectPath)),
    stopProjectWatch: async ({ watchId }) => workflowOutcome(() => watch.stop(watchId)),
    onProjectWatchEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reloadWatchedProject: vi.fn<WorkflowBridge['reloadWatchedProject']>(async ({ watchId }) =>
      workflowOutcome(() => watch.reload(watchId)),
    ),
    saveProjectCompareAndSwap: vi.fn<WorkflowBridge['saveProjectCompareAndSwap']>(async (input) =>
      workflowOutcome(() => watch.compareAndSwap(input.watchId, input.expectedRevision, input.project)),
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
    kind === 'screenshot'
      ? call<ProjectSnapshot>('screenshots:undo-delete', { projectPath, undoToken: deleted.undoToken })
      : service.undoDelete({ projectPath, undoToken: deleted.undoToken }),
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
    published,
    invalidated,
    bridge,
    hook,
    onSnapshot,
    selected,
    restore,
  };
}

it.each(['screenshot', 'text', 'drawing'] as const)(
  'does not adopt foreign readback after a warned %s Restore',
  async (kind) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, 'EIO');
    const read = f.snapshot.getMockImplementation()!;
    let foreign!: Buffer;
    f.snapshot.mockImplementationOnce(async () => {
      const changed = { ...(await f.readProject()), favourite: true };
      foreign = Buffer.from(JSON.stringify(changed, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      return read();
    });
    await expect(f.restore()).rejects.toThrow(/changed|confirm/i);
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

const kinds = ['screenshot', 'text', 'drawing'] as const;
const codes = ['EIO', 'EACCES', 'EPERM'];
const cases = kinds.flatMap((kind) => codes.map((code) => ({ kind, code })));
it.each(cases)(
  'adopts exact $kind bytes and warning after metadata $code, then saves queued metadata once',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    let token!: number;
    let result!: ProjectSnapshot;
    await act(async () => {
      token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Queued during Restore' });
      result = structuredClone(await f.restore());
      expect(result.projectRevision).toBe(projectRevisionForSource(await fs.readFile(f.projectFile)));
      expect(result.warnings?.join(' ')).toContain(COMMITTED_WRITE_WARNING);
      expect(
        await f.hook.result.current.acceptMutationSnapshot(
          result,
          f.itemId,
          token,
          undefined,
          result.projectRevision,
        ),
      ).toBe(true);
    });
    assertFault();
    for (const [index, member] of f.members.entries()) {
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
      expect(f.invalidated).toHaveBeenCalledWith(path.join(f.projectPath, member));
      expect(f.published).toHaveBeenCalledWith(path.join(f.projectPath, member), expect.anything());
    }
    expect(f.invalidated).toHaveBeenCalledWith(f.projectFile);
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(false);
    expect(f.hook.result.current.projectRevision).toBe(
      projectRevisionForSource(await fs.readFile(f.projectFile)),
    );
    expect(f.onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ warnings: result.warnings }),
      f.itemId,
    );
    expect(f.selected).toHaveBeenCalledWith(f.itemId);
    expect((await f.readProject()).name).toBe('Queued during Restore');
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(f.restore).toHaveBeenCalledOnce();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(true);
    });
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'restored',
    );
    const recover =
      kind === 'screenshot' ? recoverScreenshotTrashTransactions : recoverContentTrashTransactions;
    await expect(recover(f.projectPath)).resolves.toMatchObject([
      { status: 'undo-committed', undoAvailable: false },
    ]);
    expect(await fs.stat(f.journal).catch(() => null)).toBeNull();
    expect((await f.readProject()).name).toBe('Queued during Restore');
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
  },
);

it.each(cases)(
  'retains $kind journal and pending metadata after unreadable warned $code readback',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    f.snapshot.mockRejectedValueOnce(new Error('Readback EACCES'));
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        expect((error as Error).message).toContain('Readback EACCES');
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    const bytes = await fs.readFile(f.projectFile);
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
    expect(f.hook.result.current.externalChange?.message).toContain('Reload and compare');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect(f.restore).toHaveBeenCalledOnce();
    expect(await fs.readFile(f.projectFile)).toEqual(bytes);
  },
);

it.each(cases)(
  'keeps later foreign $kind bytes out of adoption after warned $code Restore',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    let foreign!: Buffer;
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      const result = await f.restore();
      foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
      await fs.writeFile(f.projectFile, foreign);
      expect(
        await f.hook.result.current.acceptMutationSnapshot(
          result,
          f.itemId,
          token,
          undefined,
          result.projectRevision,
        ),
      ).toBe(false);
    });
    assertFault();
    expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
    expect(f.hook.result.current.externalChange?.message).toContain('reload, compare');
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.hook.result.current.projectRevision).toBeNull();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
  },
);

it.each(cases)(
  'repairs a per-member $kind $code failure without reporting whole Restore success',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(path.join(f.projectPath, f.members[0]), code);
    const before = await fs.readFile(f.projectFile);
    await expect(f.restore()).rejects.toThrow(COMMITTED_WRITE_WARNING);
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(before);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'deleted',
    );
    for (const member of f.members)
      expect(await fs.stat(path.join(f.projectPath, member)).catch(() => null)).toBeNull();
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(f.restore).toHaveBeenCalledOnce();
  },
);

it.each(kinds)(
  'suppresses own watched %s Restore and invalidates the cached search, then detects external bytes',
  async (kind) => {
    const f = await fixture(kind);
    const query = kind === 'text' ? 'Exact restored Markdown' : kind === 'drawing' ? 'Drawing' : 'Restore';
    expect(
      (await f.search.search({ workspacePath: f.root, query })).results.some((r) => r.itemId === f.itemId),
    ).toBe(false);
    const assertFault = fault(f.projectFile, 'EPERM');
    await act(async () => {
      await f.restore();
    });
    assertFault();
    await waitFor(() => expect(f.watchedReads).toHaveBeenCalledWith(f.projectFile));
    expect(f.events).toEqual([]);
    expect(
      (await f.search.search({ workspacePath: f.root, query })).results.some((r) => r.itemId === f.itemId),
    ).toBe(true);
    await fs.writeFile(
      f.projectFile,
      JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2),
    );
    await waitFor(() => expect(f.events.some((e) => e.kind === 'external-change')).toBe(true));
  },
);

it.each(
  kinds.flatMap((kind) =>
    ['untyped', 'foreign-file', 'missing-own-marker'].map((authority) => ({ kind, authority })),
  ),
)(
  'rejects $authority authority for a committed $kind Restore and retains recovery',
  async ({ kind, authority }) => {
    const f = await fixture(kind);
    const write = f.write.getMockImplementation()!;
    let armed = false;
    if (authority === 'missing-own-marker') {
      f.published.mockImplementation(() => undefined);
      fault(f.projectFile, 'EIO');
    } else {
      f.write.mockImplementation(async (file, source) => {
        await write(file, source);
        if (file !== f.projectFile || armed) return;
        armed = true;
        if (authority === 'untyped')
          throw Object.assign(new Error('Untyped commit-shaped error'), { committed: true });
        throw new CommittedWriteError(path.join(f.projectPath, 'foreign.json'), new Error('foreign-file'));
      });
    }
    await expect(f.restore()).rejects.toThrow('no matching own-write confirmation');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
  },
);

it.each(cases)(
  'preserves journal and original warning when $kind $code rollback cannot remove a member',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const target = path.join(f.projectPath, f.members[0]);
    const assertFault = fault(target, code);
    const unlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
      if (String(file) === target) throw Object.assign(new Error('Repair EACCES'), { code: 'EACCES' });
      return unlink(file);
    });
    const before = await fs.readFile(f.projectFile);
    const outcome = f.restore();
    await expect(outcome).rejects.toThrow(COMMITTED_WRITE_WARNING);
    await expect(outcome).rejects.toThrow('Repair EACCES');
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(before);
    expect(await fs.readFile(target)).toEqual(f.bytes[0]);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(cases)(
  'preserves all $kind members when metadata changes immediately after $code commit',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    const write = f.write.getMockImplementation()!;
    let foreign!: Buffer;
    f.write.mockImplementation(async (file, source) => {
      try {
        await write(file, source);
      } catch (error) {
        if (file === f.projectFile) {
          foreign = Buffer.from(JSON.stringify({ ...(await f.readProject()), favourite: true }, null, 2));
          await fs.writeFile(file, foreign);
        }
        throw error;
      }
    });
    const outcome = f.restore();
    await expect(outcome).rejects.toThrow(COMMITTED_WRITE_WARNING);
    await expect(outcome).rejects.toThrow('changed again');
    assertFault();
    expect(await fs.readFile(f.projectFile)).toEqual(foreign);
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(kinds)(
  'rejects changed %s member readback and preserves the foreign member and journal',
  async (kind) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, 'EIO');
    const read = f.snapshot.getMockImplementation()!;
    const target = path.join(f.projectPath, f.members[0]);
    f.snapshot.mockImplementationOnce(async () => {
      await fs.writeFile(target, 'foreign member');
      return read();
    });
    await expect(f.restore()).rejects.toThrow('member content changed');
    assertFault();
    expect(await fs.readFile(target, 'utf8')).toBe('foreign member');
    expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
  },
);

it.each(kinds)('retains the %s warning and pending edits when renderer readback fails', async (kind) => {
  const f = await fixture(kind);
  fault(f.projectFile, 'EACCES');
  await act(async () => {
    const token = f.hook.result.current.beginNativeMutation();
    f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
    const result = await f.restore();
    f.bridge.reloadWatchedProject.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'io-failure',
        message: 'Renderer readback unavailable. Reload and compare.',
        retryable: false,
      },
    });
    expect(
      await f.hook.result.current.acceptMutationSnapshot(
        result,
        f.itemId,
        token,
        undefined,
        result.projectRevision,
      ),
    ).toBe(false);
  });
  expect(f.hook.result.current.externalChange?.message).toContain(COMMITTED_WRITE_WARNING);
  expect(f.hook.result.current.externalChange?.message).toContain('Renderer readback unavailable');
  expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
  expect(f.onSnapshot).not.toHaveBeenCalled();
  expect((await fs.stat(f.journal)).isDirectory()).toBe(true);
  await act(async () => {
    expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
  });
  expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
});

it.each(cases)(
  'refuses $kind adoption when the restored phase cannot be recorded after metadata $code',
  async ({ kind, code }) => {
    const f = await fixture(kind);
    const assertFault = fault(f.projectFile, code);
    const write = f.write.getMockImplementation()!;
    f.write.mockImplementation(async (file, source) => {
      if (
        file === path.join(f.journal, 'manifest.json') &&
        JSON.parse(Buffer.from(source).toString()).phase === 'restored'
      )
        throw Object.assign(new Error('Restored phase EACCES'), { code: 'EACCES' });
      await write(file, source);
    });
    await act(async () => {
      const token = f.hook.result.current.beginNativeMutation();
      f.hook.result.current.queueProjectMetadata({ ...f.source.project, name: 'Keep pending' });
      try {
        await f.restore();
        throw new Error('Unexpected success');
      } catch (error) {
        expect((error as Error).message).toContain(COMMITTED_WRITE_WARNING);
        expect((error as Error).message).toContain('Restored phase EACCES');
        await f.hook.result.current.cancelNativeMutation(token, (error as Error).message);
      }
    });
    assertFault();
    expect(f.hook.result.current.hasPendingProjectMetadata()).toBe(true);
    expect(f.onSnapshot).not.toHaveBeenCalled();
    expect(JSON.parse(await fs.readFile(path.join(f.journal, 'manifest.json'), 'utf8')).phase).toBe(
      'undoing',
    );
    for (const [index, member] of f.members.entries())
      expect(await fs.readFile(path.join(f.projectPath, member))).toEqual(f.bytes[index]);
    await act(async () => {
      expect(await f.hook.result.current.flushProjectMetadata()).toBe(false);
    });
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  },
);
