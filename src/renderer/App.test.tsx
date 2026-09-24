import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, ProjectSnapshot } from '../shared/types';
import type { ContentSearchResult } from '../shared/content-search';
import type { WorkflowBridge } from '../shared/workflow-bridge';
import { DEFAULT_PREFERENCE_SETTINGS } from '../shared/preferences';
import { CANVAS_COMMAND_EVENT, type CanvasCommand } from './canvas/commands';
import { useAppStore } from './store';
import App, { CollectionControls, matchesProjectSearch, SettingsView, userFacingErrorMessage } from './App';

// These tests exercise navigation and the real note editor; canvas rendering is covered by Electron smoke.
const annotationCanvasSpy = vi.hoisted(() => vi.fn());
const navigatorPlatformDescriptor = Object.getOwnPropertyDescriptor(navigator, 'platform');
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
    recentCollections: [],
  });
  if (navigatorPlatformDescriptor) Object.defineProperty(navigator, 'platform', navigatorPlatformDescriptor);
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
  let changeViewport: (narrow: boolean) => void;
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
      getNativeCapabilities: async () => ({
        ok: true,
        value: { windowsFileClipboard: true, globalCaptureShortcutRegistered: true },
      }),
      raiseMainWindow: async () => ({ ok: true as const, value: undefined }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Primary display',
          },
        ],
      }),
      onRegionCaptureHotkey: () => () => {},
      onCaptureTray: () => () => {},
      captureRendererReady: async () => ({ ok: true as const, value: undefined }),
      commitBufferedCapture: async () => ({
        ok: true as const,
        value: { snapshot, screenshotId: 'shot' },
      }),
      discardBufferedCapture: async () => ({ ok: true as const, value: undefined }),
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
    const viewportListeners = new Set<() => void>();
    const viewport = {
      matches: narrowViewport,
      addEventListener: (_event: string, callback: () => void) => viewportListeners.add(callback),
      removeEventListener: (_event: string, callback: () => void) => viewportListeners.delete(callback),
    };
    changeViewport = (narrow) => {
      viewport.matches = narrow;
      viewportListeners.forEach((callback) => callback());
    };
    window.matchMedia = vi.fn((query) =>
      query === '(max-width: 950px)'
        ? viewport
        : {
            matches: false,
            addEventListener() {},
            removeEventListener() {},
          },
    ) as unknown as typeof window.matchMedia;
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
    await screen.findByTestId('library-full-search');
    act(() => useAppStore.getState().setProject(editingSnapshot));
    const note = await screen.findByRole('textbox', { name: 'Description' });
    await waitFor(() => expect(note).toHaveValue('Original note'));
    return { save, note, editingSnapshot };
  }

  it('keeps the library open when launch restoration is disabled', async () => {
    localStorage.removeItem('imnota:last-session');
    const loadProject = vi.fn(async () => snapshot);
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath, icon: 'target' }],
      loadProject,
    });
    await screen.findByTestId('library-full-search');
    expect(loadProject).not.toHaveBeenCalled();
  });

  it('restores a settings checkpoint even when recent launch is disabled', async () => {
    localStorage.setItem(
      'imnota:last-session',
      JSON.stringify({
        workspacePath: '/workspace',
        view: 'settings',
        projectPath: null,
        collectionId: '001-collection',
        itemId: null,
        search: 'saved search',
        savedAt: new Date().toISOString(),
      }),
    );
    renderApp();
    await screen.findByTestId('settings-view');
    expect(useAppStore.getState().search).toBe('saved search');
    expect(localStorage.getItem('imnota:last-session')).toBeNull();
  });

  it('saves current notes before opening global search', async () => {
    const { save, note } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Latest note' } });
    fireEvent.click(screen.getByTestId('search-trigger'));
    const search = await screen.findByTestId('global-search-input');
    await waitFor(() => expect(search).toHaveFocus());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ screenshot: expect.objectContaining({ description: 'Latest note' }) }),
    );
    expect(useAppStore.getState().snapshot).not.toBeNull();
  });

  it('keeps the workspace location while global search is open', async () => {
    const loadProject = vi.fn(async () => snapshot);
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject,
    });
    await screen.findByTestId('library-full-search');
    act(() => useAppStore.getState().setProject(snapshot));

    fireEvent.click(screen.getByTestId('search-trigger'));
    const search = await screen.findByTestId('global-search-input');
    fireEvent.change(search, { target: { value: 'restored query' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(snapshot.projectPath));
    expect(useAppStore.getState().view).toBe('workspace');
    expect(loadProject).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'uses workspace labels consistently with an unvisited archived collision: %s',
    async (collision) => {
      const current = structuredClone(snapshot);
      current.projectPath = 'C:/Work/Imnota/imnota-feedback';
      current.project.name = 'Imnota Feedback';
      current.project.favourite = true;
      current.project.collections[0]!.name = 'Imnota / Collection 01';
      if (collision)
        current.project.collections.push({
          ...current.project.collections[0]!,
          id: 'archived',
          name: 'Collection 01',
          archived: true,
        });
      const label = collision ? 'Imnota / Collection 01' : 'Collection 01';
      const original = structuredClone(current.project);
      useAppStore.setState({
        recentCollections: [
          {
            projectPath: current.projectPath,
            collectionId: '001-collection',
            openedAt: '2026-01-01',
          },
        ],
      });
      renderApp({
        listProjects: async () => [{ ...current.project, projectPath: current.projectPath }],
        loadProject: async () => current,
      });
      await screen.findByTestId('library-full-search');
      act(() => useAppStore.getState().setProject(current));
      expect(document.querySelector('.crumb-current')).toHaveTextContent(label);
      expect(screen.getByTestId('collection-picker')).toHaveTextContent(label);
      const recent = within(document.getElementById('quick-access-collections')!);
      expect(recent.getByRole('button', { name: /Imnota Feedback/ })).toHaveAttribute('title', label);
      const favourites = within(document.getElementById('favourite-projects')!);
      expect(favourites.getByRole('button', { name: label })).toHaveAttribute('title', label);
      fireEvent.click(screen.getByTestId('collection-picker'));
      expect(
        within(screen.getByRole('menu', { name: 'Collections' })).getByRole('menuitemradio', {
          name: label,
        }),
      ).toBeInTheDocument();
      fireEvent.click(screen.getByRole('menuitem', { name: `Rename ${label}` }));
      expect(screen.getByDisplayValue('Imnota / Collection 01')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
      await screen.findByRole('heading', { name: 'Recent collections' });
      const row = document.querySelector('.library .project-row')!;
      expect(row.querySelector('strong')).toHaveTextContent(label);
      expect(row).toHaveAttribute('title', label);
      expect(current.project).toEqual(original);
    },
  );

  it('opens a collection from the full Recent page and records only a successful visit', async () => {
    const second = { ...snapshot.project.collections[0], id: 'second', name: 'Review two' };
    const project = { ...snapshot.project, collections: [...snapshot.project.collections, second] };
    const loadProject = vi.fn(async () => ({ ...snapshot, project }));
    useAppStore.setState({
      recentCollections: [
        { projectPath: snapshot.projectPath, collectionId: second.id, openedAt: '2026-01-01' },
      ],
    });
    renderApp({ listProjects: async () => [{ ...project, projectPath: snapshot.projectPath }], loadProject });
    await screen.findByTestId('library-full-search');
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    await screen.findByRole('heading', { name: 'Recent collections' });
    const row = document.querySelector<HTMLButtonElement>('.library .project-row')!;
    expect(row).toHaveTextContent('Review two');
    fireEvent.click(row);
    await waitFor(() => expect(useAppStore.getState().activeCollectionId).toBe('second'));
    expect(useAppStore.getState().recentCollections).toHaveLength(1);
    expect(useAppStore.getState().recentCollections[0].openedAt).not.toBe('2026-01-01');
  });

  it('keeps the previous history when a recent collection cannot be opened', async () => {
    const history = [
      { projectPath: snapshot.projectPath, collectionId: '001-collection', openedAt: '2026-01-01' },
    ];
    useAppStore.setState({ recentCollections: history });
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject: async () => {
        throw new Error('Project moved');
      },
    });
    await screen.findByTestId('library-full-search');
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    await screen.findByRole('heading', { name: 'Recent collections' });
    fireEvent.click(document.querySelector<HTMLButtonElement>('.library .project-row')!);
    expect(await screen.findByRole('alert')).toHaveTextContent('Project moved');
    expect(useAppStore.getState().recentCollections).toEqual(history);
  });

  it('uses navigation shortcuts without intercepting typing in search', async () => {
    renderApp();
    await screen.findByTestId('library-full-search');
    fireEvent.keyDown(window, { key: '2', code: 'Digit2', ctrlKey: true });
    await screen.findByRole('heading', { name: 'Recent collections' });
    const input = screen.getByRole('textbox', { name: 'Filter recent collections' });
    fireEvent.keyDown(input, { key: '3', code: 'Digit3', ctrlKey: true });
    expect(useAppStore.getState().view).toBe('recent');
  });

  it.each(['text', 'drawing'] as const)('cancels then confirms %s deletion once in the app', async (kind) => {
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
    const drawing = {
      id: 'drawing',
      kind: 'drawing' as const,
      collectionId: '001-collection',
      position: 1,
      includeInExport: true,
      createdAt: 'now',
      updatedAt: 'now',
      title: 'Diagram',
      sourceFilename: 'drawing.excalidraw',
      imageFilename: 'drawing.png',
      originalWidth: 100,
      originalHeight: 100,
    };
    let persisted: ProjectSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, schemaVersion: 4, contentItems: [text, drawing] },
    };
    const deleteContentItem = vi.fn<ImnotaBridge['deleteContentItem']>(async ({ itemId }) => {
      persisted = {
        ...persisted,
        project: {
          ...persisted.project,
          contentItems: persisted.project.contentItems!.filter((item) => item.id !== itemId),
        },
      };
      return { snapshot: persisted, undoToken: 'undo' };
    });
    renderApp({
      loadContentItem: async () => ({ item: text, markdown: 'Original', contentRevision: 'revision' }),
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted, projectRevision: 'updated' },
      }),
      deleteContentItem,
    });
    await screen.findByTestId('library-full-search');
    act(() => {
      useAppStore.getState().setProject(persisted);
      useAppStore.setState((state) => ({ settings: { ...state.settings, confirmBeforeDeletion: true } }));
    });
    await screen.findByRole('textbox', { name: 'Markdown' });
    const label = kind === 'text' ? /^Delete text block:/ : /^Delete drawing:/;
    fireEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByRole('dialog', { name: 'Delete this item?' });
    expect(deleteContentItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(screen.queryByRole('dialog', { name: 'Delete this item?' })).toBeNull();
    expect(deleteContentItem).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(deleteContentItem).toHaveBeenCalledExactlyOnceWith({
        projectPath: snapshot.projectPath,
        itemId: kind,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete this item?' })).toBeNull());
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
    await screen.findByTestId('library-full-search');
    act(() => useAppStore.getState().setProject(persisted));
    const editor = await screen.findByRole('textbox', { name: 'Markdown' });
    fireEvent.change(editor, { target: { value: 'Local edit' } });
    fireEvent.click(screen.getByRole('button', { name: /^Delete text block:/ }));
    expect(await screen.findByRole('dialog', { name: 'Delete this item?' })).toBeInTheDocument();
    act(() => useAppStore.getState().set({ activeScreenshotId: text.id }));
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

    fireEvent.click(await screen.findByRole('button', { name: /^Delete screenshot:/ }));
    expect(await screen.findByRole('dialog', { name: 'Delete this screenshot?' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep it' })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(deleteScreenshot).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^Delete screenshot:/ }));
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
    const undoDeleteScreenshot = vi.fn<ImnotaBridge['undoDeleteScreenshot']>(async () => snapshot);
    await renderEditingProject({ deleteScreenshot, undoDeleteScreenshot });
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: /^Delete screenshot:/ }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(deleteScreenshot).toHaveBeenCalled();
      const undo = screen.getByRole('button', { name: 'Undo' });
      act(() => vi.advanceTimersByTime(3501));
      expect(undo).toBeInTheDocument();
      fireEvent.click(undo);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(undoDeleteScreenshot).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        undoToken: 'undo',
      });
      expect(screen.queryByRole('dialog', { name: 'Delete this screenshot?' })).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
    useAppStore.setState((state) => ({
      settings: { ...state.settings, confirmBeforeDeletion: true },
    }));
  });

  it('deletes the screenshot captured before confirmation when the selection changes', async () => {
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async () => ({
      snapshot,
      undoToken: 'undo',
    }));
    await renderEditingProject({ deleteScreenshot });
    act(() =>
      useAppStore.setState((state) => ({
        snapshot: {
          ...state.snapshot!,
          project: {
            ...state.snapshot!.project,
            screenshots: [
              ...state.snapshot!.project.screenshots,
              { ...state.snapshot!.project.screenshots[0], id: 'second-shot', title: 'Second screen' },
            ],
          },
        },
      })),
    );

    fireEvent.click(screen.getByTestId('item-delete-shot'));
    await screen.findByRole('dialog', { name: 'Delete this screenshot?' });
    act(() => useAppStore.getState().set({ activeScreenshotId: 'second-shot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

    await waitFor(() =>
      expect(deleteScreenshot).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        screenshotId: 'shot',
      }),
    );
  });

  it('keeps a clicked row bound when another selection was already waiting for its save', async () => {
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async () => ({
      snapshot,
      undoToken: 'undo',
    }));
    const { save, note } = await renderEditingProject({ deleteScreenshot });
    act(() =>
      useAppStore.setState((state) => ({
        snapshot: {
          ...state.snapshot!,
          project: {
            ...state.snapshot!.project,
            screenshots: [
              ...state.snapshot!.project.screenshots,
              { ...state.snapshot!.project.screenshots[0], id: 'second-shot', title: 'Second screen' },
            ],
          },
        },
      })),
    );
    let finishSave!: () => void;
    save.mockImplementation(
      (input) =>
        new Promise((resolve) => {
          finishSave = () =>
            resolve({
              project: {
                ...useAppStore.getState().snapshot!.project,
                screenshots: useAppStore
                  .getState()
                  .snapshot!.project.screenshots.map((shot) =>
                    shot.id === input.screenshot.id ? input.screenshot : shot,
                  ),
              },
              savedScreenshotId: input.screenshot.id,
              conflictCreated: false,
              contentRevision: 'b'.repeat(64),
              projectRevision: 'project-content-2',
            });
        }),
    );
    fireEvent.change(note, { target: { value: 'Pending edit' } });
    fireEvent.click(screen.getByTestId('screenshot-second-shot'));
    await waitFor(() => expect(save).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('item-delete-shot'));
    await act(async () => finishSave());
    await screen.findByRole('dialog', { name: 'Delete this screenshot?' });
    expect(useAppStore.getState().activeScreenshotId).toBe('shot');
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(deleteScreenshot).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        screenshotId: 'shot',
      }),
    );
  });

  it('deletes an unselected row without changing the active screenshot', async () => {
    let persisted: ProjectSnapshot;
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async ({ screenshotId }) => {
      const current = useAppStore.getState().snapshot!;
      persisted = {
        ...current,
        project: {
          ...current.project,
          screenshots: current.project.screenshots.filter((shot) => shot.id !== screenshotId),
        },
      };
      return { snapshot: persisted, undoToken: 'undo' };
    });
    await renderEditingProject({
      deleteScreenshot,
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted, projectRevision: 'updated' },
      }),
    });
    act(() =>
      useAppStore.setState((state) => ({
        snapshot: {
          ...state.snapshot!,
          project: {
            ...state.snapshot!.project,
            screenshots: [
              ...state.snapshot!.project.screenshots,
              { ...state.snapshot!.project.screenshots[0], id: 'second-shot', title: 'Second screen' },
            ],
          },
        },
      })),
    );
    fireEvent.click(screen.getByTestId('item-delete-second-shot'));
    await screen.findByRole('dialog', { name: 'Delete this screenshot?' });
    expect(useAppStore.getState().activeScreenshotId).toBe('shot');
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    await waitFor(() =>
      expect(deleteScreenshot).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        screenshotId: 'second-shot',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('item-delete-second-shot')).not.toBeInTheDocument());
    expect(useAppStore.getState().activeScreenshotId).toBe('shot');
  });

  it('aborts a confirmed deletion when the project changed while the modal was open', async () => {
    const deleteScreenshot = vi.fn<ImnotaBridge['deleteScreenshot']>(async () => ({
      snapshot,
      undoToken: 'undo',
    }));
    await renderEditingProject({ deleteScreenshot });

    fireEvent.click(screen.getByRole('button', { name: /^Delete screenshot:/ }));
    await screen.findByRole('dialog', { name: 'Delete this screenshot?' });
    act(() =>
      useAppStore.setState((state) => ({
        snapshot: { ...state.snapshot!, projectPath: '/workspace/other-project' },
      })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete this screenshot?' })).not.toBeInTheDocument(),
    );
    expect(deleteScreenshot).not.toHaveBeenCalled();
  });

  it('opens the inspector as a focusable narrow-window drawer and dismisses it with Escape', async () => {
    await renderEditingProject({}, true);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));

    const trigger = screen.getByRole('button', { name: 'Expand inspector' });
    fireEvent.click(trigger);
    const dismiss = await screen.findByRole('button', { name: 'Close inspector' });
    expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeInTheDocument();
    expect(dismiss).toHaveFocus();

    const preventedEscape = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' });
    preventedEscape.preventDefault();
    dismiss.dispatchEvent(preventedEscape);
    expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeInTheDocument();

    fireEvent.keyDown(dismiss, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Close inspector' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Expand inspector' })).toHaveFocus();
  });

  it.each(['loading', 'error'] as const)(
    'keeps the collapsed inspector reachable while drawing content is %s',
    async (state) => {
      const drawing = {
        id: 'drawing',
        kind: 'drawing' as const,
        collectionId: '001-collection',
        position: 0,
        includeInExport: true,
        createdAt: 'now',
        updatedAt: 'now',
        title: 'Diagram',
        sourceFilename: 'drawing.excalidraw',
        imageFilename: 'drawing.png',
        originalWidth: 100,
        originalHeight: 100,
      };
      renderApp({
        loadContentItem: () =>
          state === 'loading' ? new Promise(() => {}) : Promise.reject(new Error('Could not read drawing')),
      });
      await screen.findByTestId('library-full-search');
      act(() => {
        useAppStore.getState().setProject({
          ...snapshot,
          project: { ...snapshot.project, schemaVersion: 4, contentItems: [drawing] },
        });
      });
      await screen.findByText(state === 'loading' ? 'Loading content…' : 'Content could not be loaded.');
      fireEvent.click(screen.getByRole('button', { name: 'Collapse inspector' }));
      const restore = screen.getByRole('button', { name: 'Expand inspector' });
      expect(restore.closest('.drawing-editor-tools')).not.toBeNull();
      fireEvent.click(restore);
      expect(screen.getByRole('button', { name: 'Collapse inspector' })).toBeInTheDocument();
    },
  );

  it('keeps the desktop inspector modeless', async () => {
    await renderEditingProject();
    expect(screen.queryByRole('dialog', { name: 'Inspector' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Collapse inspector' }).closest('.inspector-heading'),
    ).not.toBeNull();
    expect(screen.getByTestId('save-state')).toHaveTextContent('Saved');
    expect(screen.getByTestId('save-state').closest('.topbar')).not.toBeNull();
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  it('restores focus when an already-open inspector enters and leaves drawer mode', async () => {
    await renderEditingProject();
    const trigger = screen.getByTestId('inspector-toggle');
    trigger.focus();
    act(() => changeViewport(true));
    expect(screen.getByRole('dialog', { name: 'Inspector' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close inspector' })).toHaveFocus();
    act(() => changeViewport(false));
    expect(screen.queryByRole('dialog', { name: 'Inspector' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    act(() => changeViewport(true));
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(screen.getByRole('button', { name: 'Expand inspector' })).toHaveFocus();
  });

  it('keeps the project and notes open when saving before search fails', async () => {
    const { save, note, editingSnapshot } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Unsaved note' } });
    save.mockRejectedValueOnce(new Error('Workspace unavailable'));
    fireEvent.click(screen.getByTestId('search-trigger'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/cancelled|Workspace unavailable/i);
    expect(useAppStore.getState().snapshot?.project.id).toBe(editingSnapshot.project.id);
    expect(useAppStore.getState().activeScreenshot()?.description).toBe('Unsaved note');
    expect(screen.getByTestId('save-state')).toHaveTextContent('Save failed');
    expect(screen.getByTestId('save-state').closest('.topbar')).not.toBeNull();
    expect(note).toHaveValue('Unsaved note');
    expect(screen.queryByTestId('global-search-input')).not.toBeInTheDocument();
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
    const update = await screen.findByRole('button', { name: 'Run update in Terminal' });
    fireEvent.click(update);
    fireEvent.focus(update);
    expect(screen.getByRole('dialog', { name: 'Update status' })).toHaveTextContent(
      'Stable 0.3.0 is available. Nightly remains selected',
    );
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

  it('restores guarded close handling when update installation rejects', async () => {
    let emitUpdate: Parameters<ImnotaBridge['onUpdateStatus']>[0] = () => {};
    const installUpdate = vi.fn(async () => {
      throw new Error('Installation could not start');
    });
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });

    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Installation could not start');

    fireEvent.change(note, { target: { value: 'Edit after rejected install' } });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(false);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshot: expect.objectContaining({ description: 'Edit after rejected install' }),
        }),
      ),
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    close.mockRestore();
  });

  it('restores guarded close handling when native installation rolls back after handoff', async () => {
    let emitUpdate: Parameters<ImnotaBridge['onUpdateStatus']>[0] = () => {};
    let finishInstall!: () => void;
    const installUpdate = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishInstall = resolve;
        }),
    );
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });

    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
    act(() =>
      emitUpdate({
        state: 'downloaded',
        version: '0.3.0',
        installing: false,
        message: 'Installation could not start. Your current app is unchanged.',
      }),
    );

    fireEvent.change(note, { target: { value: 'Edit after native rollback' } });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(false);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshot: expect.objectContaining({ description: 'Edit after native rollback' }),
        }),
      ),
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    finishInstall();
    close.mockRestore();
  });

  it('restores guarded close handling when the native handoff resolves without closing', async () => {
    let emitUpdate: Parameters<ImnotaBridge['onUpdateStatus']>[0] = () => {};
    const installUpdate = vi.fn(async () => {});
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });

    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());

    fireEvent.change(note, { target: { value: 'Edit after completed handoff' } });
    const beforeUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(false);
    expect(beforeUnload.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          screenshot: expect.objectContaining({ description: 'Edit after completed handoff' }),
        }),
      ),
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    close.mockRestore();
  });

  it('allows the native close after a successful update handoff with no newer edits', async () => {
    let emitUpdate: Parameters<ImnotaBridge['onUpdateStatus']>[0] = () => {};
    const installUpdate = vi.fn(async () => {});
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });

    fireEvent.change(note, { target: { value: 'Saved before successful handoff' } });
    act(() => emitUpdate({ state: 'downloaded', version: '0.3.0' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }));
    await waitFor(() => expect(installUpdate).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        screenshot: expect.objectContaining({ description: 'Saved before successful handoff' }),
      }),
    );

    const beforeUnload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(beforeUnload)).toBe(true);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it('keeps the editor available when global search opens', async () => {
    const { note, editingSnapshot } = await renderEditingProject();
    fireEvent.click(screen.getByTestId('search-trigger'));
    await screen.findByTestId('global-search-dialog');
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
    await waitFor(() => expect(window.imnota.openProjectDialog).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    await act(async () => resolveOpen(snapshot));
    expect(useAppStore.getState().view).toBe('settings');
    expect(useAppStore.getState().snapshot).toBeNull();
  });

  it('keeps nonfatal warnings without the stale delete-undo banner', async () => {
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
    expect(screen.queryByRole('button', { name: 'Undo delete' })).not.toBeInTheDocument();
    expect(screen.queryByText(/previously deleted/)).not.toBeInTheDocument();
    expect(undoDeleteScreenshot).not.toHaveBeenCalled();
  });

  it('does not create a notice from persisted delete grants alone when reopening a project', async () => {
    const recovered = {
      ...snapshot,
      recoveredDeletes: [{ undoToken: 'screenshot-token', screenshotId: 'shot' }],
      recoveredContentDeletes: [{ undoToken: 'content-token', itemId: 'text' }],
    };
    renderApp({ openProjectDialog: async () => recovered });
    fireEvent.click(await screen.findByRole('button', { name: 'Open' }));
    await waitFor(() => expect(useAppStore.getState().snapshot).toEqual(recovered));
    expect(screen.queryByTestId('snapshot-notice')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo delete' })).not.toBeInTheDocument();
    expect(recovered.recoveredDeletes).toHaveLength(1);
    expect(recovered.recoveredContentDeletes).toHaveLength(1);
  });

  it('remembers the restored project as the most recently opened collection', async () => {
    const restored = {
      ...snapshot,
      projectPath: '/workspace/restored',
      project: { ...snapshot.project, id: 'restored-project', name: 'Restored project' },
    };
    const summary = {
      snapshotId: 'snapshot-20260913T120000000Z-00000001000040008000000000000000',
      sourceProjectId: snapshot.project.id,
      sourceProjectName: snapshot.project.name,
      createdAt: snapshot.project.createdAt,
      schemaVersion: 3,
      reason: 'manual' as const,
      fileCount: 1,
      totalSize: 100,
    };
    await renderEditingProject({
      listProjects: async () => [
        { ...snapshot.project, projectPath: snapshot.projectPath },
        { ...restored.project, projectPath: restored.projectPath },
      ],
      getBackupHistory: async () => ({
        location: '/workspace/.imnota-backups',
        snapshots: [summary],
        invalid: [],
      }),
      inspectBackupSnapshot: async () => ({
        summary,
        manifest: {
          version: 1,
          ...summary,
          files: [{ path: 'project.json', size: 100, sha256: 'a'.repeat(64) }],
        },
      }),
      restoreBackupSnapshot: async () => ({
        mode: 'new',
        projectPath: restored.projectPath,
        snapshot: restored,
      }),
    });
    act(() => useAppStore.getState().recordCollectionOpen());
    fireEvent.click(screen.getByTestId('settings-button'));
    fireEvent.click(await screen.findByRole('button', { name: 'Backups & history' }));
    fireEvent.click(await screen.findByRole('button', { name: /Project.*Manual/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore as new project' }));
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(restored.projectPath));
    expect(useAppStore.getState().recentCollections[0]).toMatchObject({
      projectPath: restored.projectPath,
      collectionId: restored.project.collections[0].id,
    });
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
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

  it('keeps the newest transient notification after an earlier notification deadline passes', async () => {
    const state: { editingSnapshot?: ProjectSnapshot } = {};
    const pasteImage = vi.fn(async () => state.editingSnapshot!);
    state.editingSnapshot = (await renderEditingProject({ pasteImage })).editingSnapshot;
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(document.querySelector('.toast')).toHaveTextContent('Screenshot pasted');

      act(() => vi.advanceTimersByTime(3000));
      fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => vi.advanceTimersByTime(501));
      expect(document.querySelector('.toast')).toHaveTextContent('Screenshot pasted');
      expect(pasteImage).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows clipboard failures as a compact notification without Electron IPC wrappers', async () => {
    await renderEditingProject({
      pasteImage: vi.fn(async () => {
        throw new Error(
          "Error invoking remote method 'screenshots:paste': Error. The clipboard does not contain an image. Copy a screenshot and try again.",
        );
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Paste from clipboard' }));
    const notification = await screen.findByTestId('error-toast');
    expect(notification).toHaveAttribute('role', 'alert');
    expect(notification).toHaveClass('toast', 'error-toast');
    expect(notification).toHaveTextContent(
      'The clipboard does not contain an image. Copy a screenshot and try again.',
    );
    expect(notification).not.toHaveTextContent('Error invoking remote method');
    expect(document.querySelector('.error-banner')).toBeNull();
  });

  it('only removes a real Error prefix from renderer error messages', () => {
    expect(userFacingErrorMessage('Error. Clipboard unavailable')).toBe('Clipboard unavailable');
    expect(userFacingErrorMessage('Errorless settings name')).toBe('Errorless settings name');
  });

  it('keeps enabled import primary and capture absent until experimental capture is enabled', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn();
    await renderEditingProject({ startRegionCapture: startRegionCapture as never });
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const importClick = vi.fn();
    fileInput.addEventListener('click', importClick);

    const addScreenshot = screen.getByRole('button', { name: 'Add screenshot' });
    expect(addScreenshot).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Capture area/ })).not.toBeInTheDocument();
    fireEvent.click(addScreenshot);
    expect(importClick).toHaveBeenCalledOnce();
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(startRegionCapture).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: '6', code: 'Digit6', ctrlKey: true, shiftKey: true });
    expect(startRegionCapture).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Screen capture is off — enable it in Settings → Features',
    );
  });

  it('admits one capture at a time and treats an overlay cancel as a quiet normal outcome', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    let resolveCapture!: (value: unknown) => void;
    const startRegionCapture = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture: startRegionCapture as never,
    });
    const capture = await screen.findByRole('button', { name: /Capture area/ });
    fireEvent.click(capture);
    fireEvent.click(capture);
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(startRegionCapture).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog', { name: 'Choose a display' })).not.toBeInTheDocument();
    expect(startRegionCapture).toHaveBeenCalledWith({
      projectPath: '/workspace/project',
      collectionId: '001-collection',
      displayId: 1,
      overlayMode: 'region',
    });
    await act(async () =>
      resolveCapture({
        ok: false,
        error: { code: 'capture-cancelled', message: 'Screen capture cancelled.', retryable: false },
      }),
    );
    expect(screen.queryByText('Screen capture cancelled.')).not.toBeInTheDocument();
  });

  it('restores an annotation tool chosen with its keyboard shortcut after Annotate', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const capturedSnapshotRef: { current?: ProjectSnapshot } = {};
    const startRegionCapture = vi.fn(async () => ({
      ok: true as const,
      value: {
        snapshot: capturedSnapshotRef.current!,
        screenshotId: 'captured',
        overlayAction: 'annotate' as const,
      },
    }));
    const { editingSnapshot } = await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: capturedSnapshotRef.current!, projectRevision: 'project-2' },
      }),
      startRegionCapture,
    });
    capturedSnapshotRef.current = {
      ...editingSnapshot,
      project: {
        ...editingSnapshot.project,
        screenshots: [
          ...editingSnapshot.project.screenshots,
          { ...editingSnapshot.project.screenshots[0]!, id: 'captured', position: 1 },
        ],
      },
    };

    fireEvent.keyDown(window, { key: 'r', code: 'KeyR' });
    await waitFor(() =>
      expect(annotationCanvasSpy.mock.calls.at(-1)?.[0]).toMatchObject({ tool: 'rectangle' }),
    );
    fireEvent.keyDown(window, { key: 'v', code: 'KeyV' });
    await waitFor(() => expect(annotationCanvasSpy.mock.calls.at(-1)?.[0]).toMatchObject({ tool: 'select' }));

    fireEvent.click(screen.getByRole('button', { name: /Capture area/ }));
    await waitFor(() => expect(startRegionCapture).toHaveBeenCalledOnce());
    await screen.findByText('Screen capture added — annotate');
    await waitFor(() =>
      expect(annotationCanvasSpy.mock.calls.at(-1)?.[0]).toMatchObject({ tool: 'rectangle' }),
    );
  });

  it('keeps capture disabled until the native snapshot and project refresh are accepted', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    let holdRefresh = false;
    let releaseProjects!: (projects: never[]) => void;
    const listProjects = vi.fn(() =>
      holdRefresh ? new Promise<never[]>((resolve) => (releaseProjects = resolve)) : Promise.resolve([]),
    );
    const repeatLastRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    let resolveCapture!: (value: unknown) => void;
    const startRegionCapture = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCapture = resolve;
        }),
    );
    const { editingSnapshot } = await renderEditingProject({
      listProjects,
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture: startRegionCapture as never,
      repeatLastRegionCapture: repeatLastRegionCapture as never,
    });
    fireEvent.click(await screen.findByRole('button', { name: /Capture area/ }));
    await waitFor(() => expect(startRegionCapture).toHaveBeenCalledOnce());
    const progress = screen.getByRole('button', { name: 'Capture in progress…' });
    expect(progress).toBeDisabled();
    expect(progress).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Capture delay' })).toBeDisabled();

    fireEvent.keyDown(document.body, { key: '6', code: 'Digit6', ctrlKey: true, shiftKey: true });
    expect(repeatLastRegionCapture).not.toHaveBeenCalled();

    holdRefresh = true;
    await act(async () =>
      resolveCapture({ ok: true, value: { snapshot: editingSnapshot, screenshotId: 'shot' } }),
    );
    await waitFor(() => expect(releaseProjects).toBeTypeOf('function'));
    expect(screen.getByRole('button', { name: 'Capture in progress…' })).toBeDisabled();
    await act(async () => releaseProjects([]));
    const ready = await screen.findByRole('button', { name: /Capture area/ });
    expect(ready).toBeEnabled();
    expect(ready).not.toHaveAttribute('aria-busy');
    fireEvent.keyDown(document.body, { key: '6', code: 'Digit6', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(repeatLastRegionCapture).toHaveBeenCalledOnce());
  });

  it('starts a cancellable 3s capture delay from the toolbar menu', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Capture delay' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Capture in 3 seconds' }));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        delaySeconds: 3,
        overlayMode: 'region',
      }),
    );
    expect(screen.queryByText('Screen capture cancelled.')).not.toBeInTheDocument();
  });

  it('starts a 5s capture delay from the toolbar control', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Capture delay' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Capture in 5 seconds' }));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        delaySeconds: 5,
        overlayMode: 'region',
      }),
    );
  });

  it('starts capture from the global hotkey IPC', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    let hotkey: (() => void) | undefined;
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
      onRegionCaptureHotkey: (handler) => {
        hotkey = handler;
        return () => {
          hotkey = undefined;
        };
      },
      onCaptureTray: () => () => {},
    });
    expect(hotkey).toEqual(expect.any(Function));
    act(() => hotkey?.());
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        overlayMode: 'region',
      }),
    );
  });

  it('acknowledges the renderer after subscribing and preserves the tray capture mode', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    let trayCapture: ((mode: 'region' | 'window' | 'display') => void) | undefined;
    const captureRendererReady = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
      onCaptureTray: (handler) => {
        trayCapture = handler;
        return () => {
          trayCapture = undefined;
        };
      },
      captureRendererReady,
    });
    expect(trayCapture).toEqual(expect.any(Function));
    expect(captureRendererReady).toHaveBeenCalledOnce();
    act(() => trayCapture?.('display'));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        overlayMode: 'display',
      }),
    );
  });

  it('does not acknowledge tray capture until deferred startup has restored state', async () => {
    let resolveSettings!: (settings: Awaited<ReturnType<ImnotaBridge['getSettings']>>) => void;
    const captureRendererReady = vi.fn(async () => ({ ok: true as const, value: undefined }));
    renderApp({
      getSettings: () =>
        new Promise<Awaited<ReturnType<ImnotaBridge['getSettings']>>>((resolve) => {
          resolveSettings = resolve;
        }),
      captureRendererReady,
    });
    expect(await screen.findByText('Preparing your workspace…')).toBeInTheDocument();
    expect(captureRendererReady).not.toHaveBeenCalled();
    await act(async () =>
      resolveSettings({
        ...useAppStore.getState().settings,
        workspacePath: null,
        openRecentOnLaunch: false,
      }),
    );
    await waitFor(() => expect(captureRendererReady).toHaveBeenCalledOnce());
  });

  it('chooses an exact Windows display before toolbar capture', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 3440, height: 1440 },
            scaleFactor: 1,

            position: 'Primary display',
          },
          {
            id: 2,
            bounds: { x: -3440, y: 0, width: 3440, height: 1440 },
            scaleFactor: 1.5,

            position: 'Left of primary',
          },
        ],
      }),
      startRegionCapture,
    });

    fireEvent.click(await screen.findByRole('button', { name: /Capture area/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Capture Left of primary/ }));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 2,
        overlayMode: 'region',
      }),
    );
  });

  it('cancels the Windows display chooser without starting capture', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn();
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Primary display',
          },
          {
            id: 2,
            bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Left of primary',
          },
        ],
      }),
      startRegionCapture: startRegionCapture as never,
    });

    fireEvent.click(await screen.findByRole('button', { name: /Capture area/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Choose a display' })).not.toBeInTheDocument(),
    );
    expect(startRegionCapture).not.toHaveBeenCalled();
  });

  it('opens the same Windows display chooser from the capture shortcut', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn();
    const raiseMainWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Primary display',
          },
          {
            id: 2,
            bounds: { x: 1920, y: -1080, width: 1920, height: 1080 },
            scaleFactor: 1.25,

            position: 'Above and right',
          },
        ],
      }),
      startRegionCapture: startRegionCapture as never,
      raiseMainWindow,
    });

    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Choose a display' })).toBeInTheDocument();
    expect(raiseMainWindow).toHaveBeenCalled();
    expect(startRegionCapture).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('rechecks the project target after display choice before starting capture', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn();
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Primary display',
          },
          {
            id: 2,
            bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,

            position: 'Right of primary',
          },
        ],
      }),
      startRegionCapture: startRegionCapture as never,
    });

    fireEvent.click(await screen.findByRole('button', { name: /Capture area/ }));
    await screen.findByRole('dialog', { name: 'Choose a display' });
    act(() => useAppStore.getState().set({ activeCollectionId: 'changed-during-choice' }));
    fireEvent.click(screen.getByRole('button', { name: /Capture Right of primary/ }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Choose a display' })).not.toBeInTheDocument(),
    );
    expect(startRegionCapture).not.toHaveBeenCalled();
  });

  it('starts capture from the primary Add screenshot action', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture: startRegionCapture as never,
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Add screenshot' }));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        overlayMode: 'region',
      }),
    );
  });

  it('starts capture from the empty canvas Add screenshot action', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'capture-cancelled' as const, message: 'Screen capture cancelled.', retryable: false },
    }));
    renderApp({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
    });
    await screen.findByTestId('library-full-search');
    act(() => useAppStore.getState().setProject(snapshot));

    fireEvent.click(await screen.findByTestId('empty-add-screenshot'));
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        collectionId: '001-collection',
        displayId: 1,
        overlayMode: 'region',
      }),
    );
  });

  it('rechecks the initiating target after a delayed flush before starting capture', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    let resolveSave!: (value: unknown) => void;
    const saveScreenshotContent = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    const startRegionCapture = vi.fn();
    const { note, editingSnapshot } = await renderEditingProject({
      saveScreenshotContent: saveScreenshotContent as never,
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture: startRegionCapture as never,
    });
    fireEvent.change(note, { target: { value: 'Needs flushing' } });
    fireEvent.click(await screen.findByRole('button', { name: /Capture area/ }));
    await waitFor(() => expect(saveScreenshotContent).toHaveBeenCalledTimes(1));
    act(() => useAppStore.getState().set({ activeCollectionId: 'changed-during-flush' }));
    await act(async () =>
      resolveSave({
        project: editingSnapshot.project,
        savedScreenshotId: 'shot',
        conflictCreated: false,
        contentRevision: 'b'.repeat(64),
        projectRevision: 'project-content-2',
      }),
    );
    await waitFor(() => expect(startRegionCapture).not.toHaveBeenCalled());
  });

  it('repeats the last region without a display chooser and explains when this session has none', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn();
    const repeatLastRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'capture-unavailable' as const,
        message: 'Capture an area first. Repeat last area uses the last successful area from this session.',
        retryable: false,
      },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      listCaptureDisplays: async () => ({
        ok: true,
        value: [
          {
            id: 1,
            bounds: { x: 0, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,
            position: 'Primary display',
          },
          {
            id: 2,
            bounds: { x: -1920, y: 0, width: 1920, height: 1080 },
            scaleFactor: 1,
            position: 'Left of primary',
          },
        ],
      }),
      startRegionCapture: startRegionCapture as never,
      repeatLastRegionCapture: repeatLastRegionCapture as never,
    });

    fireEvent.keyDown(document.body, { key: '6', code: 'Digit6', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(repeatLastRegionCapture).toHaveBeenCalledTimes(1));
    expect(repeatLastRegionCapture).toHaveBeenCalledWith({
      projectPath: '/workspace/project',
      collectionId: '001-collection',
    });
    expect(screen.queryByRole('dialog', { name: 'Choose a display' })).not.toBeInTheDocument();
    expect(startRegionCapture).not.toHaveBeenCalled();
    expect(
      await screen.findByText(
        'Capture an area first. Repeat last area uses the last successful area from this session.',
      ),
    ).toBeInTheDocument();
  });

  it('explains Linux capture unavailability from the shortcut', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Linux x86_64', configurable: true });
    const startRegionCapture = vi.fn();
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture: startRegionCapture as never,
    });
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Screen capture is unavailable on Linux — use Import or Paste',
    );
    expect(startRegionCapture).not.toHaveBeenCalled();
  });

  it('keeps a macOS permission-denied capture error visible', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'capture-permission-denied' as const,
        message:
          'Allow Screen Recording for Imnota in macOS System Settings, then try again. You can also use Import or Paste.',
        retryable: false,
      },
    }));
    await renderEditingProject({
      getPreferenceSettings: async () => ({
        ok: true,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            capture: { experimentalRegionCapture: true },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      startRegionCapture,
    });
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Allow Screen Recording');
  });

  it('buffers a capture without a current collection and restores the last-used collection', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: true as const,
      value: { buffered: true as const, overlayAction: 'save' as const },
    }));
    const loadProject = vi.fn(async () => snapshot);
    const commitBufferedCapture = vi.fn(async () => ({
      ok: true as const,
      value: { snapshot, screenshotId: 'captured' },
    }));
    const discardBufferedCapture = vi.fn(async () => ({ ok: true as const, value: undefined }));
    useAppStore.setState({
      recentCollections: [
        {
          projectPath: snapshot.projectPath,
          collectionId: '001-collection',
          openedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    await act(async () => {
      renderApp({
        getPreferenceSettings: async () => ({
          ok: true,
          value: {
            settings: {
              ...DEFAULT_PREFERENCE_SETTINGS,
              capture: { experimentalRegionCapture: true },
            },
            profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
          },
        }),
        listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
        loadProject,
        startRegionCapture,
        commitBufferedCapture,
        discardBufferedCapture,
      });
    });
    await screen.findByTestId('library-full-search');
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(startRegionCapture).toHaveBeenCalledWith({ displayId: 1, overlayMode: 'region' }),
    );
    await waitFor(() =>
      expect(commitBufferedCapture).toHaveBeenCalledWith({
        projectPath: snapshot.projectPath,
        collectionId: '001-collection',
      }),
    );
    expect(loadProject).toHaveBeenCalledWith(snapshot.projectPath);
    expect(discardBufferedCapture).not.toHaveBeenCalled();
  });

  it('discards a buffered capture when the destination prompt is cancelled', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const archived = {
      id: 'archived',
      name: 'Old',
      archived: true,
      createdAt: snapshot.project.createdAt,
      updatedAt: snapshot.project.updatedAt,
      overallContext: '',
    };
    const editingSnapshot: ProjectSnapshot = {
      ...snapshot,
      project: { ...snapshot.project, collections: [archived, snapshot.project.collections[0]!] },
    };
    const startRegionCapture = vi.fn(async () => ({
      ok: true as const,
      value: { buffered: true as const, overlayAction: 'save' as const },
    }));
    const commitBufferedCapture = vi.fn();
    const discardBufferedCapture = vi.fn(async () => ({ ok: true as const, value: undefined }));
    const raiseMainWindow = vi.fn(async () => ({ ok: true as const, value: undefined }));
    await act(async () => {
      renderApp({
        getPreferenceSettings: async () => ({
          ok: true,
          value: {
            settings: {
              ...DEFAULT_PREFERENCE_SETTINGS,
              capture: { experimentalRegionCapture: true },
            },
            profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
          },
        }),
        startRegionCapture,
        commitBufferedCapture,
        discardBufferedCapture,
        raiseMainWindow,
      });
    });
    await screen.findByTestId('library-full-search');
    act(() => {
      useAppStore.getState().setProject(editingSnapshot);
      useAppStore.getState().set({ activeCollectionId: 'missing' });
    });
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Choose a collection' })).toBeInTheDocument();
    expect(raiseMainWindow).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(discardBufferedCapture).toHaveBeenCalledOnce());
    expect(commitBufferedCapture).not.toHaveBeenCalled();
  });

  it('keeps a buffered capture when inserting it fails', async () => {
    Object.defineProperty(navigator, 'platform', { value: 'Win32', configurable: true });
    const startRegionCapture = vi.fn(async () => ({
      ok: true as const,
      value: { buffered: true as const, overlayAction: 'save' as const },
    }));
    const commitBufferedCapture = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'io-failure' as const, message: 'Disk full', retryable: true },
    }));
    const discardBufferedCapture = vi.fn(async () => ({ ok: true as const, value: undefined }));
    useAppStore.setState({
      recentCollections: [
        {
          projectPath: snapshot.projectPath,
          collectionId: '001-collection',
          openedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    await act(async () => {
      renderApp({
        getPreferenceSettings: async () => ({
          ok: true,
          value: {
            settings: {
              ...DEFAULT_PREFERENCE_SETTINGS,
              capture: { experimentalRegionCapture: true },
            },
            profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
          },
        }),
        listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
        loadProject: async () => snapshot,
        startRegionCapture,
        commitBufferedCapture,
        discardBufferedCapture,
      });
    });
    await screen.findByTestId('library-full-search');
    fireEvent.keyDown(document.body, { key: '5', code: 'Digit5', ctrlKey: true, shiftKey: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(commitBufferedCapture).toHaveBeenCalled();
    expect(discardBufferedCapture).not.toHaveBeenCalled();
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

  it('shows a partial import error while adopting committed items and restoring their collection', async () => {
    let persisted: ProjectSnapshot | undefined;
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async () => {
      const original = persisted!.project.screenshots[0]!;
      persisted = {
        ...persisted!,
        project: {
          ...persisted!.project,
          collections: persisted!.project.collections.map((collection) => ({
            ...collection,
            archived: false,
          })),
          screenshots: [
            ...persisted!.project.screenshots,
            { ...original, id: 'partial-import', title: 'First image', position: 1 },
          ],
        },
      };
      throw new Error('Second image failed');
    });
    const loadProject = vi.fn(async () => persisted!);
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      getDroppedFilePath: (file) => file.name,
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted!, projectRevision: 'project-partial-2' },
      }),
    });
    persisted = {
      ...editingSnapshot,
      project: {
        ...editingSnapshot.project,
        collections: editingSnapshot.project.collections.map((collection) => ({
          ...collection,
          archived: true,
        })),
      },
    };
    act(() => useAppStore.getState().setProject(persisted!));
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png'), new File(['second'], 'second.png')] },
    });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Second image failed'));
    expect(screen.getByRole('alert')).toHaveTextContent('Some screenshots were added');
    expect(loadProject).toHaveBeenCalledWith(editingSnapshot.projectPath);
    expect(useAppStore.getState().snapshot?.project.screenshots.map((shot) => shot.id)).toContain(
      'partial-import',
    );
    expect(useAppStore.getState().snapshot?.project.collections[0]?.archived).toBe(false);
  });

  it('keeps the original import failure when the partial-result reload fails', async () => {
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async () => {
      throw new Error('Image import failed');
    });
    const loadProject = vi.fn(async () => {
      throw new Error('Project reload failed');
    });
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      getDroppedFilePath: (file) => file.name,
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png')] },
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Image import failed'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Project reload failed');
    expect(useAppStore.getState().snapshot?.project.screenshots).toEqual(editingSnapshot.project.screenshots);
  });

  it('keeps the original import failure and open snapshot when watched recovery fails', async () => {
    const persisted: { current?: ProjectSnapshot } = {};
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async () => {
      throw new Error('Second image failed');
    });
    const loadProject = vi.fn(async () => persisted.current!);
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      getDroppedFilePath: (file) => file.name,
      reloadWatchedProject: async () => ({
        ok: false,
        error: { code: 'io-failure', message: 'Watch reload failed', retryable: true },
      }),
    });
    persisted.current = {
      ...editingSnapshot,
      project: {
        ...editingSnapshot.project,
        screenshots: [
          ...editingSnapshot.project.screenshots,
          { ...editingSnapshot.project.screenshots[0]!, id: 'partial-import', position: 1 },
        ],
      },
    };
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png'), new File(['second'], 'second.png')] },
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Second image failed'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Some screenshots were added');
    expect(useAppStore.getState().snapshot?.project.screenshots).toEqual(editingSnapshot.project.screenshots);
  });

  it('does not adopt partial imports from a project replaced at the same path', async () => {
    let rejectImport!: (reason: Error) => void;
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(
      () => new Promise<ProjectSnapshot>((_resolve, reject) => (rejectImport = reject)),
    );
    const loadProject = vi.fn(async () => snapshot);
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      getDroppedFilePath: (file) => file.name,
    });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png')] },
    });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalledOnce());
    const replacement: ProjectSnapshot = {
      ...editingSnapshot,
      project: { ...editingSnapshot.project, id: 'replacement-project' },
    };
    act(() => useAppStore.getState().setProject(replacement));
    await act(async () => rejectImport(new Error('Original import failed')));
    expect(loadProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshot?.project.id).toBe('replacement-project');
  });

  it('does not adopt a failed import over a newly selected collection', async () => {
    let rejectImport!: (reason: Error) => void;
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(
      () => new Promise<ProjectSnapshot>((_resolve, reject) => (rejectImport = reject)),
    );
    const loadProject = vi.fn(async () => snapshot);
    await renderEditingProject({ importImageFiles, loadProject, getDroppedFilePath: (file) => file.name });
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png')] },
    });
    await waitFor(() => expect(importImageFiles).toHaveBeenCalledOnce());
    act(() => useAppStore.getState().set({ activeCollectionId: 'another-collection' }));
    await act(async () => rejectImport(new Error('Original import failed')));
    expect(loadProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().activeCollectionId).toBe('another-collection');
  });

  it('does not report an unrelated collection addition as a partial import', async () => {
    const persisted: { current?: ProjectSnapshot } = {};
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async () => {
      throw new Error('Image import failed');
    });
    const loadProject = vi.fn(async () => persisted.current!);
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      getDroppedFilePath: (file) => file.name,
    });
    persisted.current = {
      ...editingSnapshot,
      project: {
        ...editingSnapshot.project,
        collections: [
          ...editingSnapshot.project.collections,
          { ...editingSnapshot.project.collections[0]!, id: 'other-collection', name: 'Other' },
        ],
        screenshots: [
          ...editingSnapshot.project.screenshots,
          {
            ...editingSnapshot.project.screenshots[0]!,
            id: 'unrelated-shot',
            collectionId: 'other-collection',
          },
        ],
      },
    };
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png')] },
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Image import failed'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Some screenshots were added');
    expect(loadProject).toHaveBeenCalledWith(editingSnapshot.projectPath);
    expect(useAppStore.getState().snapshot?.project.screenshots).toEqual(editingSnapshot.project.screenshots);
  });

  it('does not misreport a library refresh failure as a partial image import', async () => {
    const persisted: { current?: ProjectSnapshot } = {};
    const importImageFiles = vi.fn<ImnotaBridge['importImageFiles']>(async () => persisted.current!);
    const loadProject = vi.fn(async () => persisted.current!);
    const listProjects = vi
      .fn<ImnotaBridge['listProjects']>()
      .mockResolvedValueOnce([])
      .mockRejectedValue(new Error('Project list unavailable'));
    const { editingSnapshot } = await renderEditingProject({
      importImageFiles,
      loadProject,
      listProjects,
      getDroppedFilePath: (file) => file.name,
      reloadWatchedProject: async () => ({
        ok: true,
        value: { snapshot: persisted.current!, projectRevision: 'project-import-2' },
      }),
    });
    persisted.current = {
      ...editingSnapshot,
      project: {
        ...editingSnapshot.project,
        screenshots: [
          ...editingSnapshot.project.screenshots,
          { ...editingSnapshot.project.screenshots[0]!, id: 'imported', position: 1 },
        ],
      },
    };
    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [new File(['first'], 'first.png')] },
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Project list unavailable'));
    expect(screen.getByRole('alert')).not.toHaveTextContent('Some screenshots were added');
    expect(loadProject).not.toHaveBeenCalled();
    expect(useAppStore.getState().snapshot?.project.screenshots.map((shot) => shot.id)).toContain('imported');
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

  it('restores the selected settings category through Back and Forward navigation', async () => {
    renderApp();
    await screen.findByTestId('library-full-search');

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Shortcuts' }));
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByRole('heading', { name: 'Projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('settings-view');
    expect(screen.getByRole('button', { name: 'Shortcuts' })).toHaveAttribute('aria-current', 'page');

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { name: 'Projects' });
    expect(useAppStore.getState().view).toBe('projects');
  });

  it('restores a history project from disk when it is absent from the cached project list', async () => {
    let listed = [{ ...snapshot.project, projectPath: snapshot.projectPath, icon: 'target' as const }];
    const listProjects = vi.fn(async () => listed);
    const loadProject = vi.fn(async () => ({ ...snapshot, projectRevision: 'project-1' }));
    renderApp({ listProjects, loadProject });
    await screen.findByTestId('library-full-search');
    fireEvent.click(document.querySelector<HTMLButtonElement>('.project-row-main')!);
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(snapshot.projectPath));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');

    listed = [];
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByRole('heading', { name: 'Projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('settings-view');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(snapshot.projectPath));

    expect(useAppStore.getState().view).toBe('workspace');
    expect(loadProject).toHaveBeenCalledTimes(2);
  });

  it.each([
    {
      name: 'a project freshly reported as archived',
      restore: async () => ({
        ...snapshot,
        projectRevision: 'project-2',
        project: { ...snapshot.project, status: 'archived' as const },
      }),
    },
    {
      name: 'a project folder reported as unavailable',
      restore: async () => {
        throw new Error('The selected project folder is unavailable.');
      },
    },
  ])('prunes $name when Back has no valid project destination', async ({ restore }) => {
    localStorage.setItem(
      'imnota:last-session',
      JSON.stringify({
        workspacePath: '/workspace',
        view: 'workspace',
        projectPath: snapshot.projectPath,
        collectionId: '001-collection',
        itemId: null,
        search: '',
        savedAt: new Date().toISOString(),
      }),
    );
    const loadProject = vi
      .fn<ImnotaBridge['loadProject']>()
      .mockResolvedValueOnce({ ...snapshot, projectRevision: 'project-1' })
      .mockImplementationOnce(restore);
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject,
    });
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(snapshot.projectPath));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await screen.findByRole('heading', { name: 'Projects' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByTestId('settings-view');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(loadProject).toHaveBeenCalledTimes(2));
    expect(useAppStore.getState().view).toBe('settings');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Forward' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { name: 'Projects' });
  });

  it('does not adopt a delayed project creation after newer navigation', async () => {
    let resolveCreate!: (value: ProjectSnapshot) => void;
    const createProject = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    renderApp({ createProject });
    await screen.findByTestId('library-full-search');
    fireEvent.click(document.querySelector<HTMLButtonElement>('.side-nav-new-project')!);
    fireEvent.change(await screen.findByTestId('project-name-input'), { target: { value: 'Created later' } });
    fireEvent.click(screen.getByTestId('create-project-submit'));
    await waitFor(() => expect(createProject).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    await act(async () =>
      resolveCreate({
        ...snapshot,
        projectPath: '/workspace/created-later',
        projectRevision: 'created-1',
      }),
    );

    expect(useAppStore.getState().view).toBe('settings');
    expect(useAppStore.getState().snapshot).toBeNull();
  });

  it('does not open a delayed edit dialog after newer navigation', async () => {
    let resolveLoad!: (value: ProjectSnapshot) => void;
    const loadProject = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject,
    });
    fireEvent.click(await screen.findByTestId('project-edit-project-id'));
    await waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    await act(async () => resolveLoad({ ...snapshot, projectRevision: 'project-1' }));

    expect(useAppStore.getState().view).toBe('settings');
    expect(screen.queryByRole('dialog', { name: 'Edit project' })).not.toBeInTheDocument();
  });

  it('does not archive after navigation wins a delayed revision load', async () => {
    let resolveLoad!: (value: ProjectSnapshot) => void;
    const loadProject = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const setProjectArchived = vi.fn();
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject,
      setProjectArchived,
    });
    fireEvent.click(await screen.findByTestId('project-archive-project-id'));
    await waitFor(() => expect(loadProject).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    await act(async () => resolveLoad({ ...snapshot, projectRevision: 'project-1' }));

    expect(useAppStore.getState().view).toBe('settings');
    expect(setProjectArchived).not.toHaveBeenCalled();
  });

  it('deletes a project from the library row after confirmation', async () => {
    const deleteProject = vi.fn(async () => {});
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      deleteProject,
    });
    const deleteButton = await screen.findByTestId('project-delete-project-id');
    expect(deleteButton).toHaveAccessibleName(`Delete ${snapshot.project.name}`);
    expect(deleteButton).toHaveTextContent('');
    expect(screen.getByTestId('project-edit-project-id')).toHaveTextContent('');
    expect(screen.getByTestId('project-archive-project-id')).toHaveTextContent('');
    expect(screen.queryByRole('button', { name: 'Project actions' })).toBeNull();

    fireEvent.click(deleteButton);
    const dialog = await screen.findByRole('dialog', { name: `Delete ${snapshot.project.name}?` });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep project' }));
    expect(deleteProject).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByTestId('project-delete-project-id'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledExactlyOnceWith(snapshot.projectPath));
    expect(await screen.findByText('Project moved to the system trash')).toBeInTheDocument();
  });

  it('keeps a newer project open when deletion of the previous project finishes later', async () => {
    let resolveDelete!: () => void;
    let deleted = false;
    const deleteProject = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveDelete = () => {
            deleted = true;
            resolve();
          };
        }),
    );
    const nextSnapshot = {
      ...snapshot,
      projectPath: '/workspace/next-project',
      projectRevision: 'next-1',
      project: { ...snapshot.project, id: 'next-project', name: 'Next project' },
    };
    renderApp({
      listProjects: async () => (deleted ? [] : [{ ...snapshot.project, projectPath: snapshot.projectPath }]),
      deleteProject,
      openProjectDialog: async () => nextSnapshot,
    });
    fireEvent.click(await screen.findByTestId('project-delete-project-id'));
    fireEvent.click(await screen.findByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(deleteProject).toHaveBeenCalledExactlyOnceWith(snapshot.projectPath));
    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true });
    await waitFor(() => expect(useAppStore.getState().snapshot?.projectPath).toBe(nextSnapshot.projectPath));
    await act(async () => resolveDelete());

    expect(useAppStore.getState().snapshot?.projectPath).toBe(nextSnapshot.projectPath);
    expect(screen.queryByRole('dialog', { name: `Delete ${snapshot.project.name}?` })).toBeNull();
    expect(useAppStore.getState().projects).toEqual([]);
    expect(deleteProject).toHaveBeenCalledTimes(1);
  });

  it('lets screenshot selection supersede an older delayed project open', async () => {
    let resolveOpen!: (value: ProjectSnapshot) => void;
    const openProjectDialog = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          resolveOpen = resolve;
        }),
    );
    const { editingSnapshot } = await renderEditingProject({ openProjectDialog });
    const second = {
      ...editingSnapshot.project.screenshots[0]!,
      id: 'second-shot',
      title: 'Second screen',
      position: 1,
    };
    act(() =>
      useAppStore.setState((state) => ({
        snapshot: {
          ...state.snapshot!,
          project: {
            ...state.snapshot!.project,
            screenshots: [...state.snapshot!.project.screenshots, second],
          },
        },
      })),
    );

    fireEvent.keyDown(window, { key: 'o', code: 'KeyO', ctrlKey: true });
    await waitFor(() => expect(openProjectDialog).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByTestId('screenshot-second-shot'));
    await waitFor(() => expect(useAppStore.getState().activeScreenshotId).toBe('second-shot'));
    await act(async () =>
      resolveOpen({
        ...snapshot,
        projectPath: '/workspace/older-open',
        projectRevision: 'older-1',
      }),
    );

    expect(useAppStore.getState().snapshot?.projectPath).toBe(editingSnapshot.projectPath);
    expect(useAppStore.getState().activeScreenshotId).toBe('second-shot');
  });

  it('surfaces a project edit load failure without opening the dialog', async () => {
    renderApp({
      listProjects: async () => [{ ...snapshot.project, projectPath: snapshot.projectPath }],
      loadProject: async () => {
        throw new Error('Project metadata is unavailable');
      },
    });
    fireEvent.click(await screen.findByTestId('project-edit-project-id'));

    expect(await screen.findByRole('alert')).toHaveTextContent('Project metadata is unavailable');
    expect(screen.queryByRole('dialog', { name: 'Edit project' })).not.toBeInTheDocument();
  });

  it('archives a project and restores it from the Undo action with the returned revision', async () => {
    let archived = false;
    const listProjects = vi.fn(async () => [
      {
        ...snapshot.project,
        projectPath: snapshot.projectPath,
        status: archived ? ('archived' as const) : ('active' as const),
        icon: 'target' as const,
      },
    ]);
    const setProjectArchived = vi.fn<ImnotaBridge['setProjectArchived']>(async (input) => {
      archived = input.archived;
      return {
        ...snapshot,
        projectRevision: input.archived ? 'project-2' : 'project-3',
        project: { ...snapshot.project, status: input.archived ? 'archived' : 'active' },
      };
    });
    renderApp({
      listProjects,
      loadProject: async () => ({ ...snapshot, projectRevision: 'project-1' }),
      setProjectArchived,
    });
    expect((await screen.findAllByTestId('project-icon-target')).length).toBeGreaterThan(0);
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('project-archive-project-id'));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      const undo = screen.getByRole('button', { name: 'Undo' });
      act(() => vi.advanceTimersByTime(3501));
      expect(undo).toBeInTheDocument();
      fireEvent.click(undo);
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
    } finally {
      vi.useRealTimers();
    }

    expect(setProjectArchived).toHaveBeenCalledTimes(2);
    expect(setProjectArchived.mock.calls[0]?.[0]).toEqual({
      projectPath: snapshot.projectPath,
      expectedRevision: 'project-1',
      archived: true,
    });
    expect(setProjectArchived.mock.calls[1]?.[0]).toEqual({
      projectPath: snapshot.projectPath,
      expectedRevision: 'project-2',
      archived: false,
    });
    expect(await screen.findByTestId('project-archive-project-id')).toBeInTheDocument();
  });

  it('reports an archive without an Undo action when the backend returns no revision', async () => {
    const listProjects = vi.fn(async () => [
      {
        ...snapshot.project,
        projectPath: snapshot.projectPath,
        status: 'active' as const,
        icon: 'target' as const,
      },
    ]);
    renderApp({
      listProjects,
      loadProject: async () => ({ ...snapshot, projectRevision: 'project-1' }),
      setProjectArchived: async () => ({
        ...snapshot,
        project: { ...snapshot.project, status: 'archived' },
      }),
    });
    expect((await screen.findAllByTestId('project-icon-target')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('project-archive-project-id'));
    expect(await screen.findByRole('status')).toHaveTextContent('Project archived');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('reveals the annotation selected from full-content library search', async () => {
    const editingSnapshot: ProjectSnapshot = {
      ...snapshot,
      projectRevision: 'project-1',
      project: {
        ...snapshot.project,
        screenshots: [
          {
            id: 'shot',
            collectionId: '001-collection',
            originalFilename: 'screen.png',
            storedFilename: 'screen.png',
            title: 'Screen',
            description: '',
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
    const secondSnapshot: ProjectSnapshot = {
      ...editingSnapshot,
      projectPath: '/workspace/second-project',
      projectRevision: 'second-1',
      project: {
        ...editingSnapshot.project,
        id: 'second-project',
        name: 'Second project',
        favourite: true,
      },
    };
    renderApp({
      listProjects: async () => [
        { ...snapshot.project, projectPath: snapshot.projectPath },
        { ...secondSnapshot.project, projectPath: secondSnapshot.projectPath },
      ],
      searchProjects: async ({ query, scope }) => ({
        query,
        scope: scope ?? 'active',
        truncated: false,
        results: [
          {
            id: 'annotation-result',
            kind: 'annotation',
            title: 'Button label',
            excerpt: 'Change this copy',
            projectName: 'Project',
            collectionName: 'Workspace / Collection 01',
            target: {
              projectPath: snapshot.projectPath,
              collectionId: '001-collection',
              itemId: 'shot',
              annotationId: 'annotation-id',
            },
          },
        ],
      }),
      loadProject: async (projectPath) =>
        projectPath === secondSnapshot.projectPath ? secondSnapshot : editingSnapshot,
      loadScreenshotContent: async () => ({
        image: { filename: 'screen.png', dataUrl: '', width: 100, height: 100 },
        annotations: [],
        description: '',
        contentRevision: 'content-1',
      }),
    });
    fireEvent.click(await screen.findByTestId('library-full-search'));
    const searchInput = await screen.findByTestId('global-search-input');
    vi.useFakeTimers();
    try {
      fireEvent.change(searchInput, { target: { value: 'button' } });
      await act(async () => vi.advanceTimersByTime(180));
    } finally {
      vi.useRealTimers();
    }
    fireEvent.click(await screen.findByRole('option', { name: /Button label/ }));

    await waitFor(() =>
      expect(annotationCanvasSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          selectedId: 'annotation-id',
          revealAnnotationId: 'annotation-id',
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Second project' }));
    await waitFor(() =>
      expect(useAppStore.getState().snapshot?.projectPath).toBe(secondSnapshot.projectPath),
    );
    await waitFor(() =>
      expect(annotationCanvasSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ selectedId: null, revealAnnotationId: null }),
      ),
    );
  });

  it('uses full-content search from the library and scopes it to the current project list', async () => {
    renderApp();
    fireEvent.click(await screen.findByTestId('library-full-search'));
    await screen.findByTestId('global-search-input');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Active' })).toHaveAttribute('aria-pressed', 'true'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Archived' }));
    await screen.findByRole('heading', { name: 'Archived projects' });
    fireEvent.click(screen.getByTestId('library-full-search'));
    await screen.findByTestId('global-search-input');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-pressed', 'true'),
    );
  });

  it('opens search from Settings with Ctrl+F and clears a stale query', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Settings' });
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    useAppStore.getState().set({ search: 'stale query' });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    const search = await screen.findByTestId('global-search-input');
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveValue('');
  });

  it('opens global search from Recent without changing the active library filter', async () => {
    renderApp();
    await screen.findByRole('button', { name: 'Recent' });
    fireEvent.click(screen.getByRole('button', { name: 'Recent' }));
    const search = await screen.findByRole('textbox', { name: 'Filter recent collections' });
    fireEvent.change(search, { target: { value: 'recent filter' } });
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    await screen.findByTestId('global-search-input');
    expect(useAppStore.getState().view).toBe('recent');
    expect(search).toHaveValue('recent filter');
  });

  it('shows a structured content result and opens its exact item', async () => {
    const text = {
      kind: 'text' as const,
      id: 'second-text',
      collectionId: 'archived',
      position: 1,
      includeInExport: false,
      markdownFilename: 'second.md',
      createdAt: 'now',
      updatedAt: 'now',
    };
    const destination: ProjectSnapshot = {
      ...snapshot,
      project: {
        ...snapshot.project,
        schemaVersion: 4,
        favourite: true,
        status: 'archived',
        collections: [
          ...snapshot.project.collections,
          { ...snapshot.project.collections[0], id: 'archived', name: 'Archived collection', archived: true },
        ],
        contentItems: [{ ...text, id: 'first-text', position: 0, markdownFilename: 'first.md' }, text],
      },
    };
    const loadProject = vi.fn(async () => destination);
    const found: ContentSearchResult = {
      projectPath: destination.projectPath,
      projectId: destination.project.id,
      projectName: destination.project.name,
      collectionId: 'archived',
      collectionName: 'Archived collection',
      itemId: text.id,
      kind: 'text',
      label: 'Found Markdown',
      matchSource: 'markdown',
      excerpt: 'Matching context.',
    };
    renderApp({
      searchContent: async () => ({ results: [found], warnings: [], totalMatches: 1 }),
      loadProject,
      loadContentItem: async () => ({
        item: text,
        markdown: 'A matching context far beyond the preview.',
        contentRevision: 'a'.repeat(64),
      }),
    });
    const search = await screen.findByRole('textbox', { name: 'Search projects' });
    fireEvent.change(search, { target: { value: 'context' } });
    const result = await screen.findByRole('button', { name: /Found Markdown.*Matching context/i });
    expect(screen.getByText('Projects and content')).toBeVisible();
    fireEvent.click(result);
    await waitFor(() => expect(loadProject).toHaveBeenCalledWith(snapshot.projectPath));
    const editor = await screen.findByRole('textbox', { name: 'Markdown' });
    await waitFor(() => expect(editor).toHaveFocus());
    expect(useAppStore.getState().activeCollectionId).toBe('archived');
    expect(useAppStore.getState().activeScreenshotId).toBe(text.id);
    expect(useAppStore.getState().snapshot?.project).toEqual(destination.project);
    await waitFor(() => expect((editor as HTMLTextAreaElement).selectionStart).toBe(11));
  });

  it.each(['resolve', 'reject'] as const)(
    'keeps the newest search navigation when an earlier load later %ss',
    async (completion) => {
      const second: ProjectSnapshot = {
        ...snapshot,
        projectPath: '/workspace/second',
        project: { ...snapshot.project, id: 'second', name: 'Second project' },
      };
      const found = (target: ProjectSnapshot): ContentSearchResult => ({
        projectPath: target.projectPath,
        projectId: target.project.id,
        projectName: target.project.name,
        kind: 'collection',
        collectionId: target.project.collections[0].id,
        label: target.project.name,
        collectionName: target.project.collections[0].name,
        matchSource: 'context',
      });
      let resolveFirst!: (value: ProjectSnapshot) => void;
      let rejectFirst!: (error: Error) => void;
      let resolveSecond!: (value: ProjectSnapshot) => void;
      const firstLoad = new Promise<ProjectSnapshot>((yes, no) => {
        resolveFirst = yes;
        rejectFirst = no;
      });
      const secondLoad = new Promise<ProjectSnapshot>((yes) => {
        resolveSecond = yes;
      });
      const loadProject = vi.fn((projectPath: string) =>
        projectPath === snapshot.projectPath ? firstLoad : secondLoad,
      );
      renderApp({
        searchContent: async () => ({
          results: [found(snapshot), found(second)],
          warnings: [],
          totalMatches: 2,
        }),
        loadProject,
      });
      fireEvent.change(await screen.findByRole('textbox', { name: 'Search projects' }), {
        target: { value: 'context' },
      });
      const first = await screen.findByRole('button', { name: /^Project Project/ });
      fireEvent.click(first);
      await waitFor(() => expect(loadProject).toHaveBeenCalledTimes(1));
      fireEvent.click(screen.getByRole('button', { name: /Second project.*matched context/ }));
      await waitFor(() => expect(loadProject).toHaveBeenCalledTimes(2));
      await act(async () => resolveSecond(second));
      await waitFor(() => expect(useAppStore.getState().snapshot?.project.id).toBe('second'));
      await act(async () =>
        completion === 'resolve' ? resolveFirst(snapshot) : rejectFirst(new Error('old load failed')),
      );
      expect(useAppStore.getState().snapshot?.project.id).toBe('second');
      expect(screen.queryByText('old load failed')).not.toBeInTheDocument();
      await waitFor(() => expect(screen.getByRole('button', { name: 'Collection' })).toHaveFocus());
    },
  );

  it('rejects a changed project identity or missing item without applying a search selection', async () => {
    const found: ContentSearchResult = {
      projectPath: snapshot.projectPath,
      projectId: 'original-id',
      projectName: 'Old project',
      collectionId: '001-collection',
      itemId: 'removed',
      kind: 'text',
      label: 'Old item',
      matchSource: 'markdown',
    };
    renderApp({
      searchContent: async () => ({ results: [found], warnings: [], totalMatches: 1 }),
      loadProject: async () => snapshot,
    });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search projects' }), {
      target: { value: 'old' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Old item/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This search result changed or is no longer available',
    );
    expect(useAppStore.getState().snapshot).toBeNull();
    expect(useAppStore.getState().activeScreenshotId).toBeNull();
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
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }));
    expect(screen.queryByRole('heading', { name: 'Privacy' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'Dark' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));

    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    await waitFor(() => expect(setSettings).toHaveBeenCalledWith({ theme: 'dark' }));

    setSettings.mockRejectedValueOnce(new Error('unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Shortcuts' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Interface scale' }), { target: { value: '1.1' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('This preference could not be saved');
  });

  it('shows eligible release guidance once and leaves Later available when acknowledgement persistence fails', async () => {
    const preferences = {
      ...DEFAULT_PREFERENCE_SETTINGS,
      updates: { whatsNewAcknowledgedVersion: undefined },
    };
    const savePreferences = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'io-failure' as const, message: 'disk unavailable', retryable: true },
    }));
    renderApp({
      getUpdateStatus: async () => ({ state: 'idle', currentVersion: '0.2.8', channel: 'stable' }),
      getPreferenceSettings: async () => ({
        ok: true as const,
        value: {
          settings: preferences,
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
      setPreferenceSettings: savePreferences,
    });

    expect(await screen.findByTestId('whats-new-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByTestId('whats-new-dialog')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(savePreferences).toHaveBeenCalledWith({ updates: { whatsNewAcknowledgedVersion: '0.2.8' } }),
    );
    expect(screen.queryByTestId('whats-new-dialog')).not.toBeInTheDocument();
  });

  it('does not reopen acknowledged guidance on a repeat launch', async () => {
    renderApp({
      getUpdateStatus: async () => ({ state: 'idle', currentVersion: '0.2.8', channel: 'stable' }),
      getPreferenceSettings: async () => ({
        ok: true as const,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            updates: { whatsNewAcknowledgedVersion: '0.2.8' },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
    });
    await screen.findByTestId('app-shell');
    await screen.findByRole('heading', { name: 'Projects' });
    expect(screen.queryByTestId('whats-new-dialog')).not.toBeInTheDocument();
  });

  it('replays what’s new from Settings after the version has been acknowledged', async () => {
    renderApp({
      getUpdateStatus: async () => ({ state: 'idle', currentVersion: '0.2.8', channel: 'stable' }),
      getPreferenceSettings: async () => ({
        ok: true as const,
        value: {
          settings: {
            ...DEFAULT_PREFERENCE_SETTINGS,
            updates: { whatsNewAcknowledgedVersion: '0.2.8' },
          },
          profile: { settingsFileExists: true, migratedFromLegacyProfile: false },
        },
      }),
    });
    await screen.findByTestId('app-shell');
    expect(screen.queryByTestId('whats-new-dialog')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await screen.findByTestId('settings-view');
    fireEvent.click(screen.getByRole('button', { name: 'Updates & about' }));
    fireEvent.click(screen.getByRole('button', { name: 'Replay what’s new' }));
    expect(await screen.findByTestId('whats-new-dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByTestId('whats-new-dialog')).not.toBeInTheDocument();
  });
});
