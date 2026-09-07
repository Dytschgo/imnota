import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Annotation, ProjectData, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import type { WorkflowBridge } from '../../shared/workflow-bridge';
import { useProjectPersistence } from './useProjectPersistence';

function shot(id: string, description = 'Original'): ScreenshotRecord {
  return {
    id,
    collectionId: 'collection',
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: id,
    description,
    position: 0,
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    priority: 'medium',
    annotationFile: `${id}.json`,
    descriptionFile: `${id}.md`,
    originalWidth: 100,
    originalHeight: 100,
    includeInExport: true,
  };
}

function project(screenshots = [shot('one')]): ProjectData {
  return {
    schemaVersion: 3,
    id: 'project',
    name: 'Project',
    description: '',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    status: 'active',
    favourite: false,
    collections: [
      {
        id: 'collection',
        name: 'Collection',
        archived: false,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
        overallContext: '',
      },
    ],
    screenshots,
    exportPreferences: {
      includeOriginalScreenshots: false,
      includeAnnotationMetadata: true,
      template: 'default',
    },
  };
}

function snapshot(screenshots = [shot('one')]): ProjectSnapshot {
  return {
    projectPath: '/workspace/project',
    project: project(screenshots),
    thumbnails: {},
    recoveryFound: false,
  };
}

function ok<T>(value: T) {
  return { ok: true as const, value };
}

function bridge(overrides: Record<string, unknown> = {}) {
  let watchHandler: Parameters<WorkflowBridge['onProjectWatchEvent']>[0] = () => undefined;
  const value = {
    loadScreenshotContent: vi.fn(async ({ screenshot }: { screenshot: ScreenshotRecord }) => ({
      image: {
        filename: screenshot.originalFilename,
        dataUrl: `data:image/png;base64,${screenshot.id}`,
        width: 100,
        height: 100,
      },
      annotations: [],
      description: screenshot.description,
      contentRevision: `content-${screenshot.id}`,
    })),
    startProjectWatch: vi.fn(async () =>
      ok({ watchId: 'watch', projectPath: '/workspace/project', projectRevision: 'project-1' }),
    ),
    stopProjectWatch: vi.fn(async () => ok(undefined)),
    onProjectWatchEvent: vi.fn((handler) => {
      watchHandler = handler;
      return () => undefined;
    }),
    reloadWatchedProject: vi.fn(async () => ok({ snapshot: snapshot(), projectRevision: 'project-reload' })),
    saveProjectCompareAndSwap: vi.fn(async ({ project: next }: { project: ProjectData }) =>
      ok({ snapshot: { ...snapshot(next.screenshots), project: next }, projectRevision: 'project-2' }),
    ),
    saveScreenshotContent: vi.fn(async ({ screenshot }: { screenshot: ScreenshotRecord }) => ({
      project: project([screenshot]),
      savedScreenshotId: screenshot.id,
      conflictCreated: false,
      contentRevision: 'content-next',
      projectRevision: 'project-next',
    })),
    ...overrides,
  };
  return { value, emit: (event: Parameters<typeof watchHandler>[0]) => watchHandler(event) };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('useProjectPersistence', () => {
  it('serializes a deferred save, preserves newer description text, and rebases the second write', async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const save = vi
      .fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(async ({ screenshot: saved }: { screenshot: ScreenshotRecord }) => ({
        project: project([saved]),
        savedScreenshotId: saved.id,
        conflictCreated: false,
        contentRevision: 'content-3',
        projectRevision: 'project-3',
      }));
    const mock = bridge({ saveScreenshotContent: save });
    window.imnota = mock.value as never;
    const onProject = vi.fn();
    const source = snapshot();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject,
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    act(() => result.current.markScreenshotDirty(shot('one', 'A')));
    let flushed!: Promise<boolean>;
    act(() => {
      flushed = result.current.flush();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => result.current.markScreenshotDirty(shot('one', 'B')));
    await act(async () =>
      resolveFirst({
        project: project([shot('one', 'A')]),
        savedScreenshotId: 'one',
        conflictCreated: false,
        contentRevision: 'content-2',
        projectRevision: 'project-2',
      }),
    );
    await expect(flushed).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].contentRevision).toBe('content-2');
    expect(save.mock.calls[1]![0].screenshot.description).toBe('B');
    expect(onProject.mock.calls.at(-1)?.[0].screenshots[0].description).toBe('B');
    expect(save.mock.results.every((entry) => entry.type === 'return')).toBe(true);
  });

  it('rebases newer edits onto the native Copy conflict identity and exclusion flags', async () => {
    let resolveFirst!: (value: unknown) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async ({ screenshot: saved }: { screenshot: ScreenshotRecord }) => ({
        project: project([shot('one'), saved]),
        savedScreenshotId: saved.id,
        conflictCreated: false,
        contentRevision: 'copy-content-2',
        projectRevision: 'project-copy-2',
      }));
    const mock = bridge({ saveScreenshotContent: save });
    window.imnota = mock.value as never;
    const source = snapshot();
    const onSnapshot = vi.fn();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot,
        onSelectScreenshot: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    act(() => result.current.markScreenshotDirty({ ...shot('one', 'A'), updatedAt: '2026-01-02' }));
    let flushing!: Promise<boolean>;
    act(() => {
      flushing = result.current.flush();
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const newerAnnotation: Annotation = {
      id: 'newer',
      kind: 'arrow',
      x: 1,
      y: 1,
      points: [0, 0, 10, 10],
      zIndex: 0,
    };
    act(() => {
      result.current.markScreenshotDirty({ ...shot('one', 'B'), updatedAt: '2026-01-03' });
      result.current.changeAnnotations([newerAnnotation]);
    });
    const conflictRecord: ScreenshotRecord = {
      ...shot('copy', 'A'),
      storedFilename: 'copy-conflict.png',
      annotationFile: 'copy-conflict.json',
      descriptionFile: 'copy-conflict.md',
      title: 'one Copy conflict',
      includeInExport: false,
      conflict: true,
    };
    await act(async () =>
      resolveFirst({
        project: project([{ ...shot('one'), title: 'External title' }, conflictRecord]),
        savedScreenshotId: 'copy',
        conflictCreated: true,
        contentRevision: 'copy-content-1',
        projectRevision: 'project-copy-1',
      }),
    );
    await expect(flushing).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![0].screenshot).toMatchObject({
      id: 'copy',
      storedFilename: 'copy-conflict.png',
      annotationFile: 'copy-conflict.json',
      descriptionFile: 'copy-conflict.md',
      title: 'one Copy conflict',
      description: 'B',
      includeInExport: false,
      conflict: true,
    });
    expect(save.mock.calls[1]![0].annotations).toEqual([newerAnnotation]);
    expect(
      onSnapshot.mock.calls
        .flatMap(([saved]) => saved.project.screenshots)
        .find((saved) => saved.id === 'one')?.title,
    ).toBe('External title');
  });

  it('does not let pre-flush metadata overwrite a newer deferred description save', async () => {
    let resolveFirst!: (value: unknown) => void;
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async ({ screenshot: saved }: { screenshot: ScreenshotRecord }) => ({
        project: project([saved]),
        savedScreenshotId: saved.id,
        conflictCreated: false,
        contentRevision: 'content-B',
        projectRevision: 'project-B',
      }));
    const mock = bridge({ saveScreenshotContent: save });
    window.imnota = mock.value as never;
    const source = snapshot();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    const versionA = { ...source.project, favourite: true, screenshots: [shot('one', 'A')] };
    act(() => result.current.markScreenshotDirty(versionA.screenshots[0]!));
    let metadataSave!: Promise<boolean>;
    act(() => {
      metadataSave = result.current.saveProjectMetadata(versionA);
    });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    act(() => result.current.markScreenshotDirty(shot('one', 'B')));
    await act(async () =>
      resolveFirst({
        project: project([shot('one', 'A')]),
        savedScreenshotId: 'one',
        conflictCreated: false,
        contentRevision: 'content-A',
        projectRevision: 'project-A',
      }),
    );
    await expect(metadataSave).resolves.toBe(true);
    expect(mock.value.saveProjectCompareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({
        project: expect.objectContaining({
          favourite: true,
          screenshots: [expect.objectContaining({ description: 'B' })],
        }),
      }),
    );
  });

  it('keeps an external event revision pending instead of accepting it as a CAS baseline', async () => {
    const mock = bridge();
    window.imnota = mock.value as never;
    const source = snapshot();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.projectRevision).toBe('project-1'));
    act(() =>
      mock.emit({
        watchId: 'watch',
        projectPath: source.projectPath,
        kind: 'external-change',
        projectRevision: 'unreviewed',
        changedPaths: ['project.json'],
      }),
    );
    await act(async () => {
      await result.current.saveProjectMetadata({ ...source.project, name: 'Local name' });
    });
    expect(mock.value.saveProjectCompareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 'project-1' }),
    );
  });

  it('waits for watcher initialization and never falls back to an unguarded metadata save', async () => {
    let resolveWatch!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolveWatch = resolve;
    });
    const mock = bridge({ startProjectWatch: vi.fn(() => pending), saveProject: vi.fn() });
    window.imnota = mock.value as never;
    const source = snapshot();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    let saving!: Promise<boolean>;
    act(() => {
      saving = result.current.saveProjectMetadata({ ...source.project, name: 'Waiting' });
    });
    await Promise.resolve();
    expect(mock.value.saveProjectCompareAndSwap).not.toHaveBeenCalled();
    await act(async () =>
      resolveWatch(
        ok({ watchId: 'watch', projectPath: source.projectPath, projectRevision: 'ready-revision' }),
      ),
    );
    await expect(saving).resolves.toBe(true);
    expect(mock.value.saveProjectCompareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 'ready-revision' }),
    );
    expect(
      (mock.value as unknown as { saveProject: ReturnType<typeof vi.fn> }).saveProject,
    ).not.toHaveBeenCalled();
  });

  it('refreshes the accepted watcher revision after a native snapshot mutation', async () => {
    const added = shot('two');
    const mutation = snapshot([shot('one'), added]);
    const mock = bridge({
      reloadWatchedProject: vi.fn(async () =>
        ok({ snapshot: mutation, projectRevision: 'project-after-import' }),
      ),
    });
    window.imnota = mock.value as never;
    const source = snapshot();
    const onSnapshot = vi.fn();
    const onSelectScreenshot = vi.fn();
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot,
        onSelectScreenshot,
      }),
    );
    await waitFor(() => expect(result.current.projectRevision).toBe('project-1'));
    await act(async () => {
      await result.current.acceptMutationSnapshot(mutation, added.id);
    });
    await act(async () => {
      await result.current.saveProjectMetadata({ ...mutation.project, name: 'After import' });
    });
    expect(onSnapshot).toHaveBeenCalledWith(mutation);
    expect(onSelectScreenshot).toHaveBeenCalledWith('two');
    expect(mock.value.saveProjectCompareAndSwap).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 'project-after-import' }),
    );
  });

  it('accepts the authoritative revision carried by the current native snapshot contract', async () => {
    const mock = bridge();
    window.imnota = mock.value as never;
    const source = snapshot();
    const mutation = { ...snapshot([shot('one'), shot('two')]), projectRevision: 'project-native-2' };
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    await waitFor(() => expect(result.current.projectRevision).toBe('project-1'));
    await act(async () => {
      await result.current.acceptMutationSnapshot(mutation);
    });
    expect(result.current.projectRevision).toBe('project-native-2');
    expect(mock.value.reloadWatchedProject).not.toHaveBeenCalled();
  });

  it('waits for a delayed watcher before accepting a native mutation baseline', async () => {
    let resolveWatch!: (value: unknown) => void;
    const mock = bridge({
      startProjectWatch: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveWatch = resolve;
          }),
      ),
    });
    window.imnota = mock.value as never;
    const source = snapshot();
    const mutation = snapshot([shot('one'), shot('two')]);
    const { result } = renderHook(() =>
      useProjectPersistence({
        snapshot: source,
        activeScreenshot: source.project.screenshots[0]!,
        onProject: vi.fn(),
        onSnapshot: vi.fn(),
        onSelectScreenshot: vi.fn(),
      }),
    );
    let accepting!: Promise<boolean>;
    act(() => {
      accepting = result.current.acceptMutationSnapshot(mutation);
    });
    expect(mock.value.reloadWatchedProject).not.toHaveBeenCalled();
    await act(async () =>
      resolveWatch(
        ok({ watchId: 'watch', projectPath: source.projectPath, projectRevision: 'stale-before-mutation' }),
      ),
    );
    await expect(accepting).resolves.toBe(true);
    expect(mock.value.reloadWatchedProject).toHaveBeenCalledWith({ watchId: 'watch' });
    expect(result.current.projectRevision).toBe('project-reload');
  });

  it('evicts old clean image drafts while retaining the active two-entry working set', async () => {
    const screenshots = [shot('one'), shot('two'), shot('three')];
    const source = snapshot(screenshots);
    const mock = bridge();
    window.imnota = mock.value as never;
    const callbacks = { onProject: vi.fn(), onSnapshot: vi.fn(), onSelectScreenshot: vi.fn() };
    const { result, rerender } = renderHook(
      ({ active }) => useProjectPersistence({ snapshot: source, activeScreenshot: active, ...callbacks }),
      { initialProps: { active: screenshots[0]! } },
    );
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    rerender({ active: screenshots[1]! });
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('two'));
    rerender({ active: screenshots[2]! });
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('three'));
    rerender({ active: screenshots[0]! });
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    expect(mock.value.loadScreenshotContent).toHaveBeenCalledTimes(4);
  });

  it('invalidates cached clean sidecars after an accepted external reload', async () => {
    const screenshots = [shot('one'), shot('two')];
    const source = snapshot(screenshots);
    let externalSidecar = false;
    const changedAnnotation: Annotation = {
      id: 'external',
      kind: 'rectangle',
      x: 2,
      y: 2,
      width: 20,
      height: 20,
      zIndex: 0,
    };
    const load = vi.fn(async ({ screenshot }: { screenshot: ScreenshotRecord }) => ({
      image: {
        filename: screenshot.originalFilename,
        dataUrl: `data:image/png;base64,${screenshot.id}-${externalSidecar}`,
        width: 100,
        height: 100,
      },
      annotations: externalSidecar && screenshot.id === 'one' ? [changedAnnotation] : [],
      description: screenshot.description,
      contentRevision: externalSidecar ? 'external-content' : `content-${screenshot.id}`,
    }));
    const reloaded = { ...source, projectRevision: 'project-external' } as ProjectSnapshot;
    const mock = bridge({
      loadScreenshotContent: load,
      reloadWatchedProject: vi.fn(async () =>
        ok({ snapshot: reloaded, projectRevision: 'project-external' }),
      ),
    });
    window.imnota = mock.value as never;
    const callbacks = { onProject: vi.fn(), onSnapshot: vi.fn(), onSelectScreenshot: vi.fn() };
    const { result, rerender } = renderHook(
      ({ currentSnapshot, active }) =>
        useProjectPersistence({ snapshot: currentSnapshot, activeScreenshot: active, ...callbacks }),
      { initialProps: { currentSnapshot: source, active: screenshots[0]! } },
    );
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    rerender({ currentSnapshot: source, active: screenshots[1]! });
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('two'));
    rerender({ currentSnapshot: source, active: screenshots[0]! });
    await waitFor(() => expect(result.current.loadedScreenshotId).toBe('one'));
    externalSidecar = true;
    await act(async () => {
      await result.current.reloadExternal();
    });
    rerender({ currentSnapshot: reloaded, active: reloaded.project.screenshots[0]! });
    await waitFor(() => expect(result.current.annotations).toEqual([changedAnnotation]));
    expect(load).toHaveBeenCalledTimes(3);
  });
});
