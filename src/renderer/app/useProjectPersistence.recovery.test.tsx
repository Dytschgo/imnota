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
afterEach(async () => {
  setReloadProtection(null);
  for (const directory of temporary.splice(0)) {
    if (
      path.dirname(directory) !== (await fs.realpath(os.tmpdir())) ||
      !path.basename(directory).startsWith('imnota-reload-')
    )
      throw new Error('Unexpected fixture cleanup path');
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function fixture() {
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
  const contentService = new ContentPersistenceService({ snapshot, trashItem: async () => undefined });
  await contentService.create({ projectPath, collectionId: initial.collections[0].id, kind: 'text' });
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
          operations: {
            write: atomicWrite,
            unlink: (file) => fs.unlink(file),
            removeDirectory: (directory) => fs.rm(directory, { recursive: true, force: true }),
          },
        });
        return result.warning ? [result.warning] : [];
      },
    } satisfies Partial<IpcHost> as unknown as IpcHost,
  );
  const listeners = new Set<(event: ProjectWatchEvent) => void>();
  let watchNumber = 0;
  const manager = new ProjectWatchManager({
    loadSnapshot: snapshot,
    saveProject: async (_target, project) => {
      await atomicWrite(projectFile, JSON.stringify(project, null, 2));
      return snapshot();
    },
    // Deterministic events; native filesystem transactions and native CAS remain real.
    createWatch: () => ({ close() {}, on() {} }),
    randomId: () => `watch-${++watchNumber}`,
    emit: (event) => listeners.forEach((listener) => listener(event)),
  });
  const startRevision = projectRevisionForSource(await fs.readFile(projectFile));
  const bridge = {
    startProjectWatch: async () => workflowOutcome(() => manager.start(projectPath)),
    stopProjectWatch: async ({ watchId }) => workflowOutcome(() => manager.stop(watchId)),
    onProjectWatchEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reloadWatchedProject: async ({ watchId }) => workflowOutcome(() => manager.reload(watchId)),
    saveProjectCompareAndSwap: vi.fn<WorkflowBridge['saveProjectCompareAndSwap']>(async (input) =>
      workflowOutcome(() => manager.compareAndSwap(input.watchId, input.expectedRevision, input.project)),
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
  const hook = renderHook(() => {
    const persistence = useProjectPersistence({
      snapshot: source,
      activeScreenshot: shot,
      onProject: vi.fn(),
      onSnapshot: vi.fn(),
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
    readProject,
    externalEdit,
    startRevision,
    listeners,
    projectPath,
    shot,
    contentService,
    text,
    persistence,
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
