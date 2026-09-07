import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, ProjectSnapshot } from '../shared/types';
import type { WorkflowBridge } from '../shared/workflow-bridge';
import { DEFAULT_PREFERENCE_SETTINGS } from '../shared/preferences';
import { CANVAS_COMMAND_EVENT, type CanvasCommand } from './canvas/commands';
import { useAppStore } from './store';
import App, { CollectionControls, matchesProjectSearch, SettingsView } from './App';

// These tests exercise navigation and the real note editor; canvas rendering is covered by Electron smoke.
const annotationCanvasSpy = vi.hoisted(() => vi.fn());
vi.mock('./components/AnnotationCanvas', () => ({
  AnnotationCanvas: (props: unknown) => {
    annotationCanvasSpy(props);
    return null;
  },
}));

afterEach(() => {
  cleanup();
  annotationCanvasSpy.mockClear();
  useAppStore.setState({
    snapshot: null,
    activeCollectionId: '001-collection',
    activeScreenshotId: null,
    view: 'projects',
    search: '',
    rightPanelOpen: true,
  });
});

const snapshot: ProjectSnapshot = {
  projectPath: '/workspace/project',
  thumbnails: {},
  recoveryFound: false,
  project: {
    schemaVersion: 3,
    id: 'project-id',
    name: 'Project',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    favourite: false,
    collections: [
      {
        id: '001-collection',
        name: 'Workspace / Collection 01',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        overallContext: '',
      },
    ],
    screenshots: [],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      template: 'default',
    },
  },
};

describe('feedback controls', () => {
  function renderApp(overrides: Partial<ImnotaBridge & WorkflowBridge> = {}, narrowViewport = false) {
    window.imnota = {
      getSettings: async () => ({
        ...useAppStore.getState().settings,
        workspacePath: '/workspace',
        openRecentOnLaunch: false,
      }),
      listProjects: vi.fn(async () => []),
      onUpdateStatus: () => () => {},
      getUpdateStatus: async () => ({ state: 'idle' as const }),
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: DEFAULT_PREFERENCE_SETTINGS,
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      setPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: DEFAULT_PREFERENCE_SETTINGS,
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      getNativePerformanceProfile: async () => ({
        ok: true,
        value: {
          platform: 'windows',
          performanceClass: 'standard',
          reducedEffectsRecommended: false,
          reasons: [],
        },
      }),
      startProjectWatch: async ({ projectPath }: { projectPath: string }) => ({
        ok: true,
        value: { watchId: 'watch', projectPath, projectRevision: 'project-1' },
      }),
      stopProjectWatch: async () => ({ ok: true, value: undefined }),
      onProjectWatchEvent: () => () => {},
      saveProjectCompareAndSwap: async ({ project }: { project: ProjectSnapshot['project'] }) => ({
        ok: true,
        value: { snapshot: { ...snapshot, project }, projectRevision: 'project-2' },
      }),
      reloadWatchedProject: async () => ({ ok: true, value: { snapshot, projectRevision: 'project-2' } }),
      ...overrides,
    } as unknown as ImnotaBridge;
    window.matchMedia = vi.fn(() => ({ matches: narrowViewport })) as unknown as typeof window.matchMedia;
    return render(<App />);
  }

  async function renderEditingProject(
    overrides: Partial<ImnotaBridge & WorkflowBridge> = {},
    narrowViewport = false,
  ) {
    const editingSnapshot: ProjectSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        screenshots: [
          {
            id: 'shot',
            collectionId: '001-collection',
            originalFilename: 'screen.png',
            storedFilename: 'screen.png',
            title: 'Screen',
            description: 'Original note',
            position: 0,
            createdAt: snapshot.project.createdAt,
            updatedAt: snapshot.project.updatedAt,
            priority: 'medium',
            annotationFile: 'collections/001-collection/annotations/screen.png.json',
            descriptionFile: 'collections/001-collection/descriptions/screen.png.md',
            originalWidth: 100,
            originalHeight: 100,
            includeInExport: true,
          },
        ],
      },
    };
    const save = vi.fn<ImnotaBridge['saveScreenshotContent']>(async (input) => ({
      project: {
        ...editingSnapshot.project,
        screenshots: editingSnapshot.project.screenshots.map((shot) =>
          shot.id === input.screenshot.id ? input.screenshot : shot,
        ),
      },
      savedScreenshotId: input.screenshot.id,
      conflictCreated: false,
      contentRevision: 'b'.repeat(64),
      projectRevision: 'project-content-2',
    }));
    renderApp(
      {
        saveScreenshotContent: save,
        loadScreenshotContent: async () => ({
          image: { filename: 'screen.png', dataUrl: '', width: 100, height: 100 },
          annotations: [],
          description: 'Original note',
          contentRevision: 'a'.repeat(64),
        }),
        ...overrides,
      },
      narrowViewport,
    );
    await screen.findByRole('textbox', { name: 'Search projects' });
    act(() => useAppStore.getState().setProject(editingSnapshot));
    const note = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(note).toHaveValue('Original note'));
    return { save, note, editingSnapshot };
  }

  it('saves current notes before opening and focusing project search', async () => {
    const { save, note } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Latest note' } });
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    const search = await screen.findByRole('textbox', { name: 'Search projects' });
    await waitFor(() => expect(search).toHaveFocus());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ screenshot: expect.objectContaining({ description: 'Latest note' }) }),
    );
    expect(useAppStore.getState().snapshot).toBeNull();
  });

  it('deletes the conflict copy selected by a preceding text flush, preserving the external original', async () => {
    const text = {
      id: 'text',
      kind: 'text' as const,
      collectionId: '001-collection',
      position: 0,
      includeInExport: true,
      createdAt: 'now',
      updatedAt: 'now',
      markdownFilename: 'text.md',
    };
    const conflict = {
      ...text,
      id: 'text-conflict',
      position: 1,
      includeInExport: false,
      markdownFilename: 'conflict.md',
    };
    let persisted: ProjectSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, schemaVersion: 4, contentItems: [text] },
    };
    const deleteContentItem = vi.fn<ImnotaBridge['deleteContentItem']>(async ({ itemId }) => {
      persisted = {
        ...persisted,
        project: {
          ...persisted.project,
          contentItems: persisted.project.contentItems?.filter((item) => item.id !== itemId),
        },
      };
      return { snapshot: persisted, undoToken: 'undo' };
    });
    renderApp({
      loadContentItem: async ({ itemId }) => ({
        item: itemId === conflict.id ? conflict : text,
        markdown: 'Original',
        contentRevision: 'revision',
      }),
      saveContentItem: async () => {
        persisted = { ...persisted, project: { ...persisted.project, contentItems: [text, conflict] } };
        return {
          snapshot: persisted,
          itemId: conflict.id,
          contentRevision: 'revision-2',
          conflictCreated: true,
        };
      },
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted, projectRevision: 'updated' },
      }),
      deleteContentItem,
    });
    await screen.findByRole('textbox', { name: 'Search projects' });
    act(() => useAppStore.getState().setProject(persisted));
    const editor = await screen.findByRole('textbox', { name: 'Markdown' });
    fireEvent.change(editor, { target: { value: 'Local edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(await screen.findByRole('dialog', { name: 'Delete this item?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(deleteContentItem).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        itemId: conflict.id,
      }),
    );
    expect(persisted.project.contentItems?.map((item) => item.id)).toEqual([text.id]);
  });

  it('cancels and confirms screenshot deletion when confirmation is enabled', async () => {
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async () => ({
      snapshot,
      undoToken: 'undo',
    }));
    await renderEditingProject({ deleteScreenshot });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete screenshot' }));
    expect(await screen.findByRole('dialog', { name: 'Delete this screenshot?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleteScreenshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Delete screenshot' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(deleteScreenshot).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        screenshotId: 'shot',
      }),
    );
  });

  it('deletes immediately when confirmation is disabled', async () => {
    useAppStore.setState((state) => ({
      settings: { ...state.settings, confirmBeforeDeletion: false },
    }));
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async () => ({
      snapshot,
      undoToken: 'undo',
    }));
    await renderEditingProject({ deleteScreenshot });

    fireEvent.click(await screen.findByRole('button', { name: 'Delete screenshot' }));
    await waitFor(() => expect(deleteScreenshot).toHaveBeenCalled());
    expect(screen.queryByRole('dialog', { name: 'Delete this screenshot?' })).not.toBeInTheDocument();
    useAppStore.setState((state) => ({
      settings: { ...state.settings, confirmBeforeDeletion: true },
    }));
  });

  it('opens the inspector as a focusable narrow-window drawer and dismisses it with Escape', async () => {
    await renderEditingProject({}, true);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }));

    const trigger = screen.getByRole('button', { name: 'Expand inspector' });
    fireEvent.click(trigger);
    const dismiss = await screen.findByRole('button', { name: 'Close inspector' });
    expect(dismiss).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close inspector' })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it('keeps the project and notes open when saving before search fails', async () => {
    const { save, note, editingSnapshot } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Unsaved note' } });
    save.mockRejectedValueOnce(new Error('Workspace unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled|Workspace unavailable/i);
    expect(useAppStore.getState().snapshot?.project.id).toBe(editingSnapshot.project.id);
    expect(useAppStore.getState().activeScreenshot()?.description).toBe('Unsaved note');
    expect(note).toHaveValue('Unsaved note');
    expect(screen.queryByRole('textbox', { name: 'Search projects' })).not.toBeInTheDocument();
  });

  it('keeps context C visible when delayed context B finishes saving first', async () => {
    let resolveB!: (value: unknown) => void;
    let projectB!: ProjectSnapshot['project'];
    const saveMetadata = vi
      .fn()
      .mockImplementationOnce(({ project }: { project: ProjectSnapshot['project'] }) => {
        projectB = project;
        return new Promise((resolve) => {
          resolveB = resolve;
        });
      })
      .mockImplementationOnce(async ({ project }: { project: ProjectSnapshot['project'] }) => ({
        ok: true as const,
        value: {
          snapshot: { ...useAppStore.getState().snapshot!, project },
          projectRevision: 'project-C',
        },
      }));
    const { editingSnapshot } = await renderEditingProject({
      saveProjectCompareAndSwap: saveMetadata as never,
    });
    const context = screen.getByRole('textbox', { name: 'Overall context' });
    fireEvent.change(context, { target: { value: 'B' } });
    await waitFor(() => expect(saveMetadata).toHaveBeenCalledTimes(1));
    fireEvent.change(context, { target: { value: 'C' } });
    await act(async () =>
      resolveB({
        ok: true,
        value: {
          snapshot: { ...editingSnapshot, project: projectB },
          projectRevision: 'project-B',
        },
      }),
    );
    await waitFor(() => expect(saveMetadata).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(context).toHaveValue('C'));
    expect(useAppStore.getState().snapshot?.project.collections[0]?.overallContext).toBe('C');
  });

  it('routes a remapped fit shortcut to the canvas without redispatching keydown', async () => {
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            shortcuts: { bindings: { 'canvas.fit': 'Ctrl+9' } },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
    });
    const canvasProps = annotationCanvasSpy.mock.calls.at(-1)?.[0] as {
      stageRef: { current: { container(): HTMLElement } | null };
    };
    const container = document.createElement('div');
    canvasProps.stageRef.current = { container: () => container };
    const commands: CanvasCommand[] = [];
    container.addEventListener(CANVAS_COMMAND_EVENT, (event) => {
      commands.push((event as CustomEvent<CanvasCommand>).detail);
    });
    const keydowns = vi.fn();
    window.addEventListener('keydown', keydowns);
    fireEvent.keyDown(window, { key: '9', code: 'Digit9', ctrlKey: true });
    window.removeEventListener('keydown', keydowns);
    expect(commands).toEqual(['fit']);
    expect(keydowns).toHaveBeenCalledOnce();
  });

  it('runs an available Terminal update from the app banner', async () => {
    const downloadUpdate = vi.fn(async () => {});
    renderApp({
      getUpdateStatus: async () => ({
        state: 'available',
        version: '0.3.0',
        terminalCommand: '/bin/bash /tmp/imnota-update/Update.command',
        message: 'Stable 0.3.0 is available. Nightly remains selected for future checks.',
      }),
      downloadUpdate,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Run update in Terminal' }));
    expect(screen.getByText(/Stable 0.3.0 is available. Nightly remains selected/)).toBeInTheDocument();
    await waitFor(() => expect(downloadUpdate).toHaveBeenCalledOnce());
  });

  it('does not restart for an update when the current editor state cannot be saved', async () => {
    let emitUpdate: (status: { state: 'downloaded'; version: string }) => void = () => {};
    const installUpdate = vi.fn(async () => {});
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });
    fireEvent.change(note, { target: { value: 'Unsaved note' } });
    save.mockRejectedValueOnce(new Error('Workspace unavailable'));
    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved|Workspace unavailable/i);
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it('keeps the editor available when project refresh fails', async () => {
    const { note, editingSnapshot } = await renderEditingProject();
    vi.mocked(window.imnota.listProjects).mockRejectedValueOnce(new Error('Refresh unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh unavailable');
    expect(useAppStore.getState().snapshot).toBe(editingSnapshot);
    expect(note).toHaveValue('Original note');
  });

  it('ignores a delayed project-open result after newer navigation', async () => {
    let resolveOpen!: (value: ProjectSnapshot) => void;
    renderApp({
      openProjectDialog: vi.fn(
        () =>
          new Promise<ProjectSnapshot | null>((resolve) => {
            resolveOpen = resolve;
          }),
      ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    await act(async () => resolveOpen(snapshot));
    expect(useAppStore.getState().view).toBe('settings');
    expect(useAppStore.getState().snapshot).toBeNull();
  });

  it('surfaces nonfatal snapshot warnings and recovered delete grants', async () => {
    const recovered = {
      ...snapshot,
      projectRevision: 'project-recovered',
      warnings: ['A screenshot transaction was recovered after an interrupted write.'],
      recoveredDeletes: [{ undoToken: 'undo-token', screenshotId: 'restored-shot' }],
    } as ProjectSnapshot;
    const restored = { ...snapshot, projectRevision: 'project-restored' } as ProjectSnapshot;
    const undoDeleteScreenshot = vi.fn(async () => restored);
    renderApp({ openProjectDialog: vi.fn(async () => recovered), undoDeleteScreenshot });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    expect(await screen.findByTestId('snapshot-notice')).toHaveTextContent(
      'A screenshot transaction was recovered',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }));
    await waitFor(() =>
      expect(undoDeleteScreenshot).toHaveBeenCalledWith({
        projectPath: snapshot.projectPath,
        undoToken: 'undo-token',
      }),
    );
  });

  it('keeps Description Undo separate from canvas annotation history', async () => {
    const { note } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Rewritten description' } });
    expect(note).toHaveValue('Rewritten description');
    fireEvent.click(screen.getByRole('button', { name: 'Undo description' }));
    expect(note).toHaveValue('Original note');
  });

  it('shares the semantic text color and manual override between Select and Text creation', async () => {
    await renderEditingProject();
    await waitFor(() =>
      expect(annotationCanvasSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ annotationColor: '#ffffff', theme: 'dark', tool: 'select' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Use color #22c55e' }));
    await waitFor(() =>
      expect(annotationCanvasSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ annotationColor: '#22c55e', theme: 'dark', tool: 'select' }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Text/ }));
    await waitFor(() =>
      expect(annotationCanvasSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ annotationColor: '#22c55e', theme: 'dark', tool: 'text' }),
      ),
    );
  });

  it('appends pasted screenshots and activates the newest one', async () => {
    let persisted = snapshot;
    const { editingSnapshot } = await renderEditingProject({
      pasteImage: vi.fn(async () => {
        const original = editingSnapshot.project.screenshots[0];
        persisted = {
          ...editingSnapshot,
          project: {
            ...editingSnapshot.project,
            screenshots: [
              original,
              {
                ...original,
                id: 'pasted',
                storedFilename: '002-pasted.png',
                originalFilename: 'pasted.png',
                title: 'pasted.png',
                position: 1,
                annotationFile: 'collections/001-collection/annotations/002-pasted.png.json',
                descriptionFile: 'collections/001-collection/descriptions/002-pasted.png.md',
              },
            ],
          },
        };
        return persisted;
      }),
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted, projectRevision: 'project-paste-2' },
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await waitFor(() => expect(useAppStore.getState().activeScreenshotId).toBe('pasted'));
  });

  it('preserves picker order and activates the last imported screenshot', async () => {
    const snapshotRef: { current?: ProjectSnapshot } = {};
    let persisted = snapshot;
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async (input) => {
      const editingSnapshot = snapshotRef.current!;
      const original = editingSnapshot.project.screenshots[0];
      const added = input.paths.map((file, index) => ({
        ...original,
        id: `import-${index}`,
        storedFilename: `00${index + 2}-${file}`,
        originalFilename: file,
        title: file,
        position: index + 1,
        annotationFile: `collections/001-collection/annotations/00${index + 2}-${file}.json`,
        descriptionFile: `collections/001-collection/descriptions/00${index + 2}-${file}.md`,
      }));
      persisted = {
        ...editingSnapshot,
        project: { ...editingSnapshot.project, screenshots: [original, ...added] },
      };
      return persisted;
    });
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      getDroppedFilePath: (file) => file.name,
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted, projectRevision: 'project-import-2' },
      }),
    });
    snapshotRef.current = editingSnapshot;
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [first, second] } });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalled());
    expect(importImageFiles.mock.calls[0][0].paths).toEqual(['first.png', 'second.png']);
    await waitFor(() => expect(useAppStore.getState().activeScreenshotId).toBe('import-1'));
  });

  it('defers context autosave during a slow import and rebases it onto the import revision', async () => {
    let resolveImport!: (value: ProjectSnapshot) => void;
    const importedRef: { current?: ProjectSnapshot } = {};
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          resolveImport = resolve;
        }),
    );
    const saveMetadata = vi.fn(async ({ project }: { project: ProjectSnapshot['project'] }) => ({
      ok: true as const,
      value: {
        snapshot: { ...importedRef.current!, project, projectRevision: 'project-context-3' },
        projectRevision: 'project-context-3',
      },
    }));
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      getDroppedFilePath: (file) => file.name,
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: importedRef.current!, projectRevision: 'project-import-2' },
      }),
      saveProjectCompareAndSwap: saveMetadata,
    });
    const file = new File(['slow'], 'slow.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByRole('textbox', { name: 'Overall context' }), {
      target: { value: 'Typed during slow import' },
    });
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 800)));
    expect(saveMetadata).not.toHaveBeenCalled();

    const original = editingSnapshot.project.screenshots[0]!;
    importedRef.current = {
      ...editingSnapshot,
      projectRevision: 'project-import-2',
      project: {
        ...editingSnapshot.project,
        screenshots: [
          original,
          {
            ...original,
            id: 'slow-import',
            originalFilename: 'slow.png',
            storedFilename: '002-slow.png',
            title: 'slow.png',
            position: 1,
          },
        ],
      },
    };
    await act(async () => resolveImport(importedRef.current!));
    await waitFor(() => expect(saveMetadata).toHaveBeenCalledOnce());
    expect(saveMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 'project-import-2',
        project: expect.objectContaining({
          collections: [expect.objectContaining({ overallContext: 'Typed during slow import' })],
          screenshots: expect.arrayContaining([expect.objectContaining({ id: 'slow-import' })]),
        }),
      }),
    );
    await waitFor(() =>
      expect(useAppStore.getState().snapshot?.project.collections[0]?.overallContext).toBe(
        'Typed during slow import',
      ),
    );
  });

  it('focuses the existing library search without clearing its query', async () => {
    renderApp();
    const search = await screen.findByRole('textbox', { name: 'Search projects' });
    fireEvent.change(search, { target: { value: '  design  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('  design  ');
  });

  it('opens search from Settings with Ctrl+F and clears a stale query', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    useAppStore.getState().set({ search: 'stale query' });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const search = await screen.findByRole('textbox', { name: 'Search projects' });
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('');
  });

  it('focuses search from Recent without changing the active library filter', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Recent' });
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    const search = await screen.findByRole('textbox', { name: 'Search projects' });
    fireEvent.change(search, { target: { value: 'recent filter' } });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await waitFor(() => expect(search).toHaveFocus());
    expect(useAppStore.getState().view).toBe('recent');
    expect(search).toHaveValue('recent filter');
  });

  it('trims project queries before matching project metadata', () => {
    expect(
      matchesProjectSearch(
        { ...snapshot.project, projectPath: snapshot.projectPath, searchText: 'A design note' },
        '  design  ',
      ),
    ).toBe(true);
  });

  it('creates an automatically named empty collection and activates it', async () => {
    let finishCreate!: (result: ProjectSnapshot) => void;
    const editCollection = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          finishCreate = resolve;
        }),
    );
    window.imnota = { editCollection } as unknown as ImnotaBridge;
    useAppStore.setState({ snapshot, activeCollectionId: '001-collection' });
    render(<CollectionControls onFlush={vi.fn(async () => {})} />);

    fireEvent.click(screen.getByRole('button', { name: 'New collection' }));

    await waitFor(() =>
      expect(editCollection).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        action: 'create',
        name: undefined,
      }),
    );
    const created: ProjectSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        collections: [
          { ...snapshot.project.collections[0], archived: true },
          {
            id: '002-collection',
            name: 'workspace / Collection 02',
            archived: false,
            createdAt: '2026-01-02',
            updatedAt: '2026-01-02',
            overallContext: '',
          },
        ],
      },
    };
    await act(async () => finishCreate(created));
    expect(useAppStore.getState().activeCollectionId).toBe('002-collection');
    expect(useAppStore.getState().activeScreenshotId).toBeNull();
  });

  it('saves an accessible theme option and reports preference failures', async () => {
    const setSettings = vi.fn(async () => ({ ...useAppStore.getState().settings, theme: 'dark' as const }));
    window.imnota = {
      setSettings,
      onUpdateStatus: () => () => {},
      getUpdateStatus: async () => ({ state: 'idle' as const }),
    } as unknown as ImnotaBridge;
    render(<SettingsView />);

    expect(screen.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('heading', { name: 'Privacy' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Workspace & privacy' }));
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeVisible();
    expect(screen.queryByRole('radio', { name: 'Dark' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ theme: 'dark' }));

    setSettings.mockRejectedValueOnce(new Error('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Editing & shortcuts' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Interface scale' }), { target: { value: '1.1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('This preference could not be saved');
  });
});
