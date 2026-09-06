import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, ProjectSnapshot } from '../shared/types';
import { useAppStore } from './store';
import App, { CollectionControls, matchesProjectSearch, SettingsView } from './App';

// These tests exercise navigation and the real note editor; canvas rendering is covered by Electron smoke.
vi.mock('./components/AnnotationCanvas', () => ({ AnnotationCanvas: () => null }));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    snapshot: null,
    activeCollectionId: '001-collection',
    activeScreenshotId: null,
    view: 'projects',
    search: '',
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
  function renderApp(overrides: Partial<ImnotaBridge> = {}) {
    window.imnota = {
      getSettings: async () => ({
        ...useAppStore.getState().settings,
        workspacePath: '/workspace',
        openRecentOnLaunch: false,
      }),
      listProjects: vi.fn(async () => []),
      onUpdateStatus: () => () => {},
      getUpdateStatus: async () => ({ state: 'idle' as const }),
      ...overrides,
    } as unknown as ImnotaBridge;
    window.matchMedia = vi.fn(() => ({ matches: false })) as unknown as typeof window.matchMedia;
    return render(<App />);
  }

  async function renderEditingProject(overrides: Partial<ImnotaBridge> = {}) {
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
    }));
    renderApp({
      saveScreenshotContent: save,
      loadScreenshotContent: async () => ({
        image: { filename: 'screen.png', dataUrl: '', width: 100, height: 100 },
        annotations: [],
        description: 'Original note',
        contentRevision: 'a'.repeat(64),
      }),
      ...overrides,
    });
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

  it('keeps the project and notes open when saving before search fails', async () => {
    const { save, note, editingSnapshot } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Unsaved note' } });
    save.mockRejectedValueOnce(new Error('Workspace unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Search was cancelled');
    expect(useAppStore.getState().snapshot?.project.id).toBe(editingSnapshot.project.id);
    expect(useAppStore.getState().activeScreenshot()?.description).toBe('Unsaved note');
    expect(note).toHaveValue('Unsaved note');
    expect(screen.queryByRole('textbox', { name: 'Search projects' })).not.toBeInTheDocument();
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
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be saved');
    expect(installUpdate).not.toHaveBeenCalled();
  });

  it('keeps newer edits open when an update save is still in flight', async () => {
    let emitUpdate: (status: { state: 'downloaded'; version: string }) => void = () => {};
    const installUpdate = vi.fn(async () => {});
    const { save, note, editingSnapshot } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });
    let finishSave!: () => void;
    save.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              project: editingSnapshot.project,
              savedScreenshotId: input.screenshot.id,
              conflictCreated: false,
              contentRevision: 'b'.repeat(64),
            });
        }),
    );
    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    fireEvent.change(note, { target: { value: 'Typed while saving' } });
    await act(async () => finishSave());
    expect(installUpdate).not.toHaveBeenCalled();
    expect(note).toHaveValue('Typed while saving');
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose restart again');
  });

  it('does not override newer navigation when a search save completes', async () => {
    const { save, editingSnapshot } = await renderEditingProject();
    let finishSave!: () => void;
    save.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              project: editingSnapshot.project,
              savedScreenshotId: input.screenshot.id,
              conflictCreated: false,
              contentRevision: 'b'.repeat(64),
            });
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await act(async () => finishSave());
    expect(useAppStore.getState().view).toBe('settings');
    expect(screen.queryByRole('textbox', { name: 'Search projects' })).not.toBeInTheDocument();
  });

  it('keeps newer edits open when an older search save completes', async () => {
    const { save, note, editingSnapshot } = await renderEditingProject();
    let finishSave!: () => void;
    save.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              project: editingSnapshot.project,
              savedScreenshotId: input.screenshot.id,
              conflictCreated: false,
              contentRevision: 'b'.repeat(64),
            });
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    fireEvent.change(note, { target: { value: 'Typed while saving' } });
    await act(async () => finishSave());
    expect(useAppStore.getState().snapshot?.project.id).toBe(editingSnapshot.project.id);
    expect(useAppStore.getState().activeScreenshot()?.description).toBe('Typed while saving');
    expect(note).toHaveValue('Typed while saving');
    expect(screen.queryByRole('textbox', { name: 'Search projects' })).not.toBeInTheDocument();
  });

  it('keeps the editor available when project refresh fails', async () => {
    const { note, editingSnapshot } = await renderEditingProject();
    vi.mocked(window.imnota.listProjects).mockRejectedValueOnce(new Error('Refresh unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh unavailable');
    expect(useAppStore.getState().snapshot).toBe(editingSnapshot);
    expect(note).toHaveValue('Original note');
  });

  it('keeps Description Undo separate from canvas annotation history', async () => {
    const { note } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Rewritten description' } });
    expect(note).toHaveValue('Rewritten description');
    fireEvent.click(screen.getByRole('button', { name: 'Undo description' }));
    expect(note).toHaveValue('Original note');
  });

  it('appends pasted screenshots and activates the newest one', async () => {
    const { editingSnapshot } = await renderEditingProject({
      pasteImage: vi.fn(async () => {
        const original = editingSnapshot.project.screenshots[0];
        return {
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
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    await waitFor(() => expect(useAppStore.getState().activeScreenshotId).toBe('pasted'));
  });

  it('preserves picker order and activates the last imported screenshot', async () => {
    const snapshotRef: { current?: ProjectSnapshot } = {};
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
      return {
        ...editingSnapshot,
        project: { ...editingSnapshot.project, screenshots: [original, ...added] },
      };
    });
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      getDroppedFilePath: (file) => file.name,
    });
    snapshotRef.current = editingSnapshot;
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [first, second] } });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalled());
    expect(importImageFiles.mock.calls[0][0].paths).toEqual(['first.png', 'second.png']);
    await waitFor(() => expect(useAppStore.getState().activeScreenshotId).toBe('import-1'));
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
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
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

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ theme: 'dark' }));

    setSettings.mockRejectedValueOnce(new Error('unavailable'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Interface scale' }), { target: { value: '1.1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('This preference could not be saved');
  });
});
