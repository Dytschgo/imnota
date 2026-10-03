import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ImnotaBridge, ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type { ProjectWatchEvent, WorkflowBridge } from '../../shared/workflow-bridge';
import { validateProject } from '../../shared/schema';
import { emptyProject } from '../../shared/utils';
import { useProjectPersistence } from './useProjectPersistence';
import { useContentPersistence } from '../content/useContentPersistence';
import { reloadWindow, setReloadProtection } from './reload-guard';
import { ContentPersistenceService } from '../../../electron/content-persistence';
import { ProjectWatchManager, projectRevisionForSource } from '../../../electron/project-watch';
import { registerScreenshotIpc } from '../../../electron/ipc-screenshots';
import type { IpcHost } from '../../../electron/main';
import type { IpcRouter } from '../../../electron/ipc-router';
import { commitScreenshotFileTransaction } from '../../../electron/screenshot-transaction-adapter';
import { atomicWrite } from '../../../electron/files';
import { workflowOutcome } from '../../../electron/workflow-errors';

// No Electron process, clipboard, native image decoding or desktop access in this filesystem test.
vi.mock('electron', () => ({ app: {}, shell: {} }));
vi.mock('../../../electron/native-clipboard', () => ({ nativeClipboard: {} }));

const temporary: string[] = [];
const stopWatches: Array<() => void> = [];
afterEach(async () => {
  setReloadProtection(null);
  for (const stop of stopWatches.splice(0)) stop();
  for (const directory of temporary.splice(0)) {
    if (
      path.dirname(directory) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(directory).startsWith('imnota-reload-')
    )
      throw new Error('Unexpected fixture cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function fixture(options: { nativeWatch?: boolean; cleanupWarning?: boolean } = {}) {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-reload-')));
  temporary.push(projectPath);
  const projectFile = path.join(projectPath, 'project.json');
  const initial = emptyProject('Recovery', '');
  const shot: ScreenshotRecord = {
    id: 'shot_one',
    collectionId: initial.collections[0].id,
    originalFilename: 'one.png',
    storedFilename: 'one.png',
    title: 'One',
    description: 'Original',
    position: 0,
    createdAt: initial.createdAt,
    updatedAt: initial.updatedAt,
    priority: 'medium',
    annotationFile: 'collections/001-collection/annotations/one.png.json',
    descriptionFile: 'collections/001-collection/descriptions/one.png.md',
    originalWidth: 1,
    originalHeight: 1,
    includeInExport: true,
  };
  initial.screenshots = [shot];
  await fs.writeFile(projectFile, JSON.stringify(initial, null, 2));
  for (const [relative, value] of [
    [shot.annotationFile, '[]'],
    [shot.descriptionFile, shot.description],
  ]) {
    await fs.mkdir(path.dirname(path.join(projectPath, relative)), { recursive: true });
    await fs.writeFile(path.join(projectPath, relative), value);
  }
  const readProject = async (): Promise<ProjectData> => JSON.parse(await fs.readFile(projectFile, 'utf8'));
  const snapshot = async (): Promise<ProjectSnapshot> => ({
    projectPath,
    project: await readProject(),
    thumbnails: {},
    recoveryFound: false,
  });
  let manager: ProjectWatchManager | undefined = undefined;
  let injectCleanupWarning = false;
  const warnedJournals = new Set<string>();
  const transactionOperations = {
    write: async (file: string, source: string | Uint8Array) => {
      await atomicWrite(file, source);
      manager?.recordSelfWrite(file, source);
    },
    unlink: async (file: string) => {
      await fs.unlink(file);
      manager?.recordSelfDelete(file);
    },
    removeDirectory: async (directory: string) => {
      if (injectCleanupWarning && !warnedJournals.has(directory)) {
        warnedJournals.add(directory);
        throw new Error('Injected journal cleanup failure');
      }
      await fs.rm(directory, { recursive: true, force: true });
    },
  };
  const contentService = new ContentPersistenceService({
    snapshot,
    trashItem: async () => undefined,
    transactionOperations,
  });
  await contentService.create({ projectPath, collectionId: initial.collections[0].id, kind: 'text' });
  injectCleanupWarning = options.cleanupWarning === true;
  const source = await snapshot();
  const text = source.project.contentItems![0];
  const contentRevision = (description: string, annotations: string) =>
    createHash('sha256').update(description).update('\0').update(annotations).digest('hex');
  const readScreenshotFiles = async (_target: string, screenshot: ScreenshotRecord) => {
    const annotationSource = await fs.readFile(path.join(projectPath, screenshot.annotationFile));
    const descriptionSource = await fs.readFile(path.join(projectPath, screenshot.descriptionFile));
    const annotationsJson = annotationSource.toString();
    const description = descriptionSource.toString();
    return {
      annotationSource,
      descriptionSource,
      annotationsJson,
      description,
      revision: contentRevision(description, annotationsJson),
    };
  };
  type SaveInput = Parameters<ImnotaBridge['saveScreenshotContent']>[0];
  let saveHandler!: (
    event: IpcMainInvokeEvent,
    input: SaveInput,
  ) => ReturnType<ImnotaBridge['saveScreenshotContent']>;
  // Exercise the real screenshot save handler and native transaction, with only host I/O adapters supplied.
  registerScreenshotIpc(
    {
      handle: (channel: string, handler: typeof saveHandler) => {
        if (channel === 'projects:save-screenshot') saveHandler = handler;
      },
    } as unknown as IpcRouter,
    {
      assertProjectPath: async () => projectPath,
      readProjectMutationBaseline: async () => {
        const projectSource = await fs.readFile(projectFile);
        return {
          project: validateProject(JSON.parse(projectSource.toString())),
          projectSource,
          projectRevision: projectRevisionForSource(projectSource),
        };
      },
      readScreenshotFiles,
      contentRevision,
      readOptionalFile: async (target: string) => fs.readFile(target).catch(() => null),
      assertProjectRevision: async (_target: string, expected: string) => {
        expect(projectRevisionForSource(await fs.readFile(projectFile))).toBe(expected);
      },
      commitFileTransaction: async (target, kind, writes, assertBaseline) => {
        const result = await commitScreenshotFileTransaction(target, {
          kind,
          writes,
          assertBaseline,
          operations: transactionOperations,
        });
        return result.warning ? [result.warning] : [];
      },
    } satisfies Partial<IpcHost> as unknown as IpcHost,
  );
  const listeners = new Set<(event: ProjectWatchEvent) => void>();
  let watchNumber = 0;
  const deliveredEvents: ProjectWatchEvent[] = [];
  manager = new ProjectWatchManager({
    loadSnapshot: snapshot,
    saveProject: async (_target, project) => {
      await atomicWrite(projectFile, JSON.stringify(project, null, 2));
      return snapshot();
    },
    // Most cases inject delivery at exact boundaries. One case explicitly uses native fs.watch.
    ...(options.nativeWatch ? {} : { createWatch: () => ({ close() {}, on() {} }) }),
    randomId: () => `watch-${++watchNumber}`,
    emit: (event) => {
      deliveredEvents.push(event);
      listeners.forEach((listener) => listener(event));
    },
  });
  const watchManager = manager;
  stopWatches.push(() => watchManager.stopAll());
  const startRevision = projectRevisionForSource(await fs.readFile(projectFile));
  const bridge = {
    startProjectWatch: vi.fn<WorkflowBridge['startProjectWatch']>(async () =>
      workflowOutcome(() => watchManager.start(projectPath)),
    ),
    stopProjectWatch: async ({ watchId }) => workflowOutcome(() => watchManager.stop(watchId)),
    onProjectWatchEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reloadWatchedProject: vi.fn<WorkflowBridge['reloadWatchedProject']>(async ({ watchId }) =>
      workflowOutcome(() => watchManager.reload(watchId)),
    ),
    saveProjectCompareAndSwap: vi.fn<WorkflowBridge['saveProjectCompareAndSwap']>(async (input) =>
      workflowOutcome(() =>
        watchManager.compareAndSwap(input.watchId, input.expectedRevision, input.project),
      ),
    ),
    loadScreenshotContent: async () => ({
      image: { filename: 'one.png', dataUrl: '', width: 1, height: 1 },
      annotations: [],
      description: shot.description,
      contentRevision: contentRevision(shot.description, '[]'),
    }),
    saveScreenshotContent: vi.fn<ImnotaBridge['saveScreenshotContent']>(async (input) =>
      saveHandler({} as IpcMainInvokeEvent, input),
    ),
    loadContentItem: (input) => contentService.load(input),
    saveContentItem: vi.fn<ImnotaBridge['saveContentItem']>((input) => contentService.save(input)),
  } satisfies Partial<ImnotaBridge & WorkflowBridge>;
  window.imnota = bridge as unknown as ImnotaBridge;
  const onSnapshot = vi.fn();
  const hook = renderHook(() => {
    const persistence = useProjectPersistence({
      snapshot: source,
      activeScreenshot: shot,
      onProject: vi.fn(),
      onSnapshot,
      onSelectScreenshot: vi.fn(),
    });
    const content = useContentPersistence({
      snapshot: source,
      itemId: text.id,
      beforeSave: persistence.prepareContentSave,
      beginMutation: persistence.beginNativeMutation,
      acceptSnapshot: (next, id, token, transition) =>
        persistence.acceptMutationSnapshot(next, id, token, transition),
      cancelMutation: persistence.cancelNativeMutation,
    });
    return { persistence, content };
  });
  await waitFor(() => {
    expect(hook.result.current.persistence.projectRevision).toBe(startRevision);
    expect(hook.result.current.persistence.loadedScreenshotId).toBe(shot.id);
    expect(hook.result.current.content.content?.item.id).toBe(text.id);
  });
  act(() => {
    hook.result.current.persistence.markScreenshotDirty({ ...shot, description: 'Screenshot draft' });
    hook.result.current.content.change({ markdown: 'Text draft' });
    hook.result.current.persistence.queueProjectMetadata({ ...source.project, name: 'Local name' });
  });
  const { persistence, content } = hook.result.current;
  hook.unmount();
  expect(listeners.size).toBe(0);
  setReloadProtection({
    allowUnload: vi.fn(),
    flush: () =>
      persistence.withReloadWatch(async () => {
        let saved = true;
        for (const save of [content.flush, persistence.flushProjectDrafts, persistence.flushProjectMetadata])
          if (!(await save())) saved = false;
        return saved;
      }),
  });
  const externalEdit = async () => {
    await atomicWrite(projectFile, JSON.stringify({ ...(await readProject()), favourite: true }, null, 2));
  };
  return {
    bridge,
    deliveredEvents,
    onSnapshot,
    projectFile,
    readProject,
    externalEdit,
    startRevision,
    listeners,
    projectPath,
    shot,
    contentService,
    text,
    persistence,
    diskRevision: async () => projectRevisionForSource(await fs.readFile(projectFile)),
    injectWatchError: () =>
      listeners.forEach((listener) =>
        listener({
          watchId: `watch-${watchNumber}`,
          projectPath,
          kind: 'watch-error',
          changedPaths: [],
          message: 'Monitoring disconnected',
        }),
      ),
  };
}

it.each(['none', 'before recovery', 'before metadata CAS', 'watch event', 'metadata write fails'] as const)(
  'recovers mixed dirty drafts using native transactions and CAS (%s)',
  async (change) => {
    const f = await fixture();
    if (change === 'before recovery') await f.externalEdit();
    const originalSave = f.bridge.saveProjectCompareAndSwap.getMockImplementation()!;
    let failMetadata = change === 'metadata write fails';
    f.bridge.saveProjectCompareAndSwap.mockImplementation(async (input) => {
      // Both own native writes must be in the accepted chain before metadata can use their revision.
      const contentSave = await f.bridge.saveContentItem.mock.results[0].value;
      const screenshotSave = await f.bridge.saveScreenshotContent.mock.results[0].value;
      expect(contentSave.projectRevisionTransition?.before).toBe(f.startRevision);
      expect(screenshotSave.projectRevisionTransition?.before).toBe(
        contentSave.projectRevisionTransition?.after,
      );
      expect(input.expectedRevision).toBe(screenshotSave.projectRevisionTransition?.after);
      if (change === 'before metadata CAS') await f.externalEdit();
      if (failMetadata) {
        return { ok: false, error: { code: 'io-failure', message: 'Disk full', retryable: true } };
      }
      return originalSave(input);
    });
    if (change === 'watch event') {
      const saveContent = f.bridge.saveContentItem.getMockImplementation()!;
      f.bridge.saveContentItem.mockImplementation(async (input) => {
        expect(f.listeners.size).toBe(1);
        f.listeners.forEach((listener) =>
          listener({
            watchId: 'watch-2',
            projectPath: f.projectPath,
            kind: 'watch-error',
            changedPaths: [],
            message: 'Monitoring disconnected',
          }),
        );
        return saveContent(input);
      });
    }
    const reload = vi.fn();
    expect(await reloadWindow({}, reload)).toBe(change === 'none');
    expect(reload).toHaveBeenCalledTimes(change === 'none' ? 1 : 0);
    expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
    expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
    expect((await f.contentService.load({ projectPath: f.projectPath, itemId: f.text.id })).markdown).toBe(
      'Text draft',
    );
    expect(await fs.readFile(path.join(f.projectPath, f.shot.descriptionFile), 'utf8')).toBe(
      'Screenshot draft',
    );
    const disk = await f.readProject();
    expect(disk.name).toBe(change === 'none' ? 'Local name' : 'Recovery');
    expect(disk.favourite).toBe(change === 'before recovery' || change === 'before metadata CAS');
    expect(f.persistence.hasPendingProjectMetadata()).toBe(change !== 'none');
    expect(f.listeners.size).toBe(0);
    if (change === 'before recovery' || change === 'watch event')
      expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    else expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalled();
    if (change === 'metadata write fails') {
      failMetadata = false;
      // The content adoption is retried, but an already accepted own write must not become a false conflict.
      expect(await reloadWindow({}, reload)).toBe(true);
      expect((await f.readProject()).name).toBe('Local name');
      expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
      expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
    }
  },
);

it.each(['before content result', 'between content and screenshot', 'after both transitions'] as const)(
  'retries a transient injected watch error %s without rewriting committed drafts',
  async (timing) => {
    const f = await fixture();
    const realReload = f.bridge.reloadWatchedProject.getMockImplementation()!;
    if (timing === 'before content result') {
      const save = f.bridge.saveContentItem.getMockImplementation()!;
      f.bridge.saveContentItem.mockImplementation(async (input) => {
        const result = await save(input);
        f.injectWatchError();
        return result;
      });
    } else if (timing === 'between content and screenshot') {
      const save = f.bridge.saveScreenshotContent.getMockImplementation()!;
      f.bridge.saveScreenshotContent.mockImplementation(async (input) => {
        f.injectWatchError();
        return save(input);
      });
    } else {
      const reload = f.bridge.reloadWatchedProject.getMockImplementation()!;
      f.bridge.reloadWatchedProject.mockImplementation(async (input) => {
        const result = await reload(input);
        if (f.bridge.saveScreenshotContent.mock.calls.length) f.injectWatchError();
        return result;
      });
    }
    const reload = vi.fn();
    expect(await reloadWindow({}, reload)).toBe(false);
    expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
    expect((await f.readProject()).name).toBe('Recovery');
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    const committedRevision = await f.diskRevision();
    // The replacement watch is healthy. Do not re-save committed drafts to obtain new lineage.
    f.bridge.reloadWatchedProject.mockImplementation(realReload);
    expect(await reloadWindow({}, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
    expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(f.bridge.saveProjectCompareAndSwap.mock.calls[0][0].expectedRevision).toBe(committedRevision);
    expect((await f.readProject()).name).toBe('Local name');
    expect(f.persistence.hasPendingProjectMetadata()).toBe(false);
    expect(f.listeners.size).toBe(0);
    expect(await fs.readdir(path.join(f.projectPath, '.imnota-transactions')).catch(() => [])).toEqual([]);
  },
);

async function commitWithWatchError(f: Awaited<ReturnType<typeof fixture>>, reload: () => void) {
  const save = f.bridge.saveContentItem.getMockImplementation()!;
  f.bridge.saveContentItem.mockImplementation(async (input) => {
    const result = await save(input);
    f.injectWatchError();
    return result;
  });
  expect(await reloadWindow({}, reload)).toBe(false);
  expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
  return f.diskRevision();
}

it.each(['startup rejects', 'startup emits error', 'reconnect read fails', 'reconnect emits error'] as const)(
  'retains committed lineage while replacement watch %s, then completes on a healthy attempt',
  async (failure) => {
    const f = await fixture();
    const reload = vi.fn();
    const committedRevision = await commitWithWatchError(f, reload);
    const start = f.bridge.startProjectWatch.getMockImplementation()!;
    const read = f.bridge.reloadWatchedProject.getMockImplementation()!;
    if (failure === 'startup rejects') {
      f.bridge.startProjectWatch.mockResolvedValue({
        ok: false,
        error: {
          code: 'watch-failure',
          message: 'Still disconnected',
          retryable: true,
        },
      });
    } else if (failure === 'startup emits error') {
      f.bridge.startProjectWatch.mockImplementation(async (input) => {
        const result = await start(input);
        f.injectWatchError();
        return result;
      });
    } else {
      f.bridge.reloadWatchedProject.mockImplementation(async (input) => {
        if (failure === 'reconnect read fails')
          return {
            ok: false,
            error: {
              code: 'io-failure',
              message: 'Still disconnected',
              retryable: true,
            },
          };
        const result = await read(input);
        f.injectWatchError();
        return result;
      });
    }
    expect(await reloadWindow({}, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(await f.diskRevision()).toBe(committedRevision);
    expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect(f.listeners.size).toBe(0);
    f.bridge.startProjectWatch.mockImplementation(start);
    f.bridge.reloadWatchedProject.mockImplementation(read);
    expect(await reloadWindow({}, reload)).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
    expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledOnce();
    expect(f.bridge.saveProjectCompareAndSwap.mock.calls[0][0].expectedRevision).toBe(committedRevision);
    expect((await f.readProject()).name).toBe('Local name');
    expect(f.persistence.hasPendingProjectMetadata()).toBe(false);
  },
);

it.each(['before fallback', 'during outage', 'just before retry CAS'] as const)(
  'preserves real external metadata bytes %s through watch-error recovery',
  async (timing) => {
    const f = await fixture();
    const reload = vi.fn();
    if (timing === 'before fallback') await f.externalEdit();
    const committedRevision = await commitWithWatchError(f, reload);
    if (timing === 'during outage') await f.externalEdit();
    let externalBytes = await fs.readFile(f.projectFile);
    if (timing === 'just before retry CAS') {
      const save = f.bridge.saveProjectCompareAndSwap.getMockImplementation()!;
      f.bridge.saveProjectCompareAndSwap.mockImplementation(async (input) => {
        expect(input.expectedRevision).toBe(committedRevision);
        await f.externalEdit();
        externalBytes = await fs.readFile(f.projectFile);
        return save(input); // Real native hash comparison rejects this stale revision.
      });
    }
    expect(await reloadWindow({}, reload)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(await fs.readFile(f.projectFile)).toEqual(externalBytes);
    expect((await f.readProject()).favourite).toBe(true);
    expect((await f.readProject()).name).toBe('Recovery');
    expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
    expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
    expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
    expect(f.bridge.saveProjectCompareAndSwap).toHaveBeenCalledTimes(
      timing === 'just before retry CAS' ? 1 : 0,
    );
    expect(f.listeners.size).toBe(0);
  },
);

it('retains a true native fs.watch external event when monitoring subsequently errors', async () => {
  const f = await fixture({ nativeWatch: true });
  const reload = vi.fn();
  await commitWithWatchError(f, reload);
  const ownBytes = await fs.readFile(f.projectFile);
  const start = f.bridge.startProjectWatch.getMockImplementation()!;
  f.bridge.startProjectWatch.mockImplementationOnce(async (input) => {
    const grant = await start(input);
    if (!grant.ok) throw new Error('Expected a native watch');
    await f.externalEdit();
    // Await actual native filesystem delivery, not an injected external-change callback.
    await waitFor(() =>
      expect(
        f.deliveredEvents.some(
          (event) =>
            event.watchId === grant.value.watchId &&
            event.kind === 'external-change' &&
            event.changedPaths.includes('project.json'),
        ),
      ).toBe(true),
    );
    f.injectWatchError();
    return grant;
  });
  expect(await reloadWindow({}, reload)).toBe(false);
  const externalBytes = await fs.readFile(f.projectFile);
  expect((await f.readProject()).favourite).toBe(true);
  expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  // Even restoring the old exact bytes cannot erase the observed external-change decision.
  await fs.writeFile(f.projectFile, ownBytes);
  expect(await reloadWindow({}, reload)).toBe(false);
  expect(await fs.readFile(f.projectFile)).toEqual(ownBytes);
  expect(externalBytes).not.toEqual(ownBytes);
  expect(reload).not.toHaveBeenCalled();
  expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
  expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
  expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
});

it.each(['content', 'screenshot'] as const)(
  'fails closed when the committed %s result lacks lineage',
  async (kind) => {
    const f = await fixture();
    if (kind === 'content') {
      const save = f.bridge.saveContentItem.getMockImplementation()!;
      f.bridge.saveContentItem.mockImplementation(async (input) => ({
        ...(await save(input)),
        projectRevisionTransition: undefined,
      }));
    } else {
      const save = f.bridge.saveScreenshotContent.getMockImplementation()!;
      f.bridge.saveScreenshotContent.mockImplementation(async (input) => ({
        ...(await save(input)),
        projectRevisionTransition: undefined,
      }));
    }
    const reload = vi.fn();
    expect(await reloadWindow({}, reload)).toBe(false);
    const bytes = await fs.readFile(f.projectFile);
    expect(await reloadWindow({}, reload)).toBe(false);
    expect(await fs.readFile(f.projectFile)).toEqual(bytes);
    expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
    expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
    expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
  },
);

it('retains committed transaction warnings and exact lineage through a blocked adoption', async () => {
  const f = await fixture({ cleanupWarning: true });
  const reload = vi.fn();
  const committedRevision = await commitWithWatchError(f, reload);
  const content = await f.bridge.saveContentItem.mock.results[0].value;
  const screenshot = await f.bridge.saveScreenshotContent.mock.results[0].value;
  expect(content.snapshot.warnings?.join(' ')).toContain('Injected journal cleanup failure');
  expect(screenshot.warnings?.join(' ')).toContain('Injected journal cleanup failure');
  expect(content.projectRevisionTransition?.before).toBe(f.startRevision);
  expect(screenshot.projectRevisionTransition?.before).toBe(content.projectRevisionTransition?.after);
  expect(screenshot.projectRevisionTransition?.after).toBe(committedRevision);
  expect(f.onSnapshot).toHaveBeenCalledWith(
    expect.objectContaining({ warnings: content.snapshot.warnings }),
    f.text.id,
  );
  expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
  expect(await reloadWindow({}, reload)).toBe(true);
  expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
  expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
  expect(f.bridge.saveProjectCompareAndSwap.mock.calls[0][0].expectedRevision).toBe(committedRevision);
  expect((await f.readProject()).name).toBe('Local name');
});

it('rejects a replay with the same after revision but a different before revision', async () => {
  const f = await fixture();
  const reload = vi.fn();
  await commitWithWatchError(f, reload);
  const committed = await f.bridge.saveContentItem.mock.results[0].value;
  expect(committed.projectRevisionTransition).toBeDefined();
  committed.projectRevisionTransition.before = 'unrelated-baseline';
  const bytes = await fs.readFile(f.projectFile);
  expect(await reloadWindow({}, reload)).toBe(false);
  expect(await fs.readFile(f.projectFile)).toEqual(bytes);
  expect(f.bridge.saveProjectCompareAndSwap).not.toHaveBeenCalled();
  expect(f.persistence.hasPendingProjectMetadata()).toBe(true);
  expect(reload).not.toHaveBeenCalled();
  expect(f.bridge.saveContentItem).toHaveBeenCalledOnce();
  expect(f.bridge.saveScreenshotContent).toHaveBeenCalledOnce();
});
