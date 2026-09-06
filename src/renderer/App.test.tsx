import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, ProjectSnapshot } from '../shared/types';
import { useAppStore } from './store';
import App, { matchesProjectSearch, RoundControls, SettingsView } from './App';
import { EMPTY_NOTES } from '../shared/utils';

// These tests exercise navigation and the real note editor; canvas rendering is covered by Electron smoke.
vi.mock('./components/AnnotationCanvas', () => ({ AnnotationCanvas: () => null }));

afterEach(() => {
  cleanup();
  useAppStore.setState({
    snapshot: null,
    activeRoundId: '001-first-feedback',
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
    schemaVersion: 2,
    id: 'project-id',
    name: 'Project',
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    status: 'active',
    tags: ['design'],
    favourite: false,
    rounds: [
      {
        id: '001-first-feedback',
        name: 'Subfolder 1',
        archived: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    screenshots: [],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      includedFields: [],
      overallInstructions: '',
      desiredOutcome: '',
      technicalConstraints: '',
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
        exportPreferences: { ...snapshot.project.exportPreferences, includedFields: ['problem'] },
        screenshots: [
          {
            id: 'shot',
            roundId: '001-first-feedback',
            originalFilename: 'screen.png',
            storedFilename: 'screen.png',
            title: 'Screen',
            description: '',
            position: 0,
            createdAt: snapshot.project.createdAt,
            updatedAt: snapshot.project.updatedAt,
            tags: [],
            priority: 'medium',
            status: 'draft',
            annotationFile: 'shot.json',
            notesFile: 'shot.md',
            originalWidth: 100,
            originalHeight: 100,
            includeInExport: true,
          },
        ],
      },
    };
    const save = vi.fn(async () => {});
    renderApp({
      saveScreenshotContent: save,
      loadScreenshotContent: async () => ({
        image: { filename: 'screen.png', dataUrl: '', width: 100, height: 100 },
        annotations: [],
        notes: { ...EMPTY_NOTES, problem: 'Original note' },
      }),
      ...overrides,
    });
    await screen.findByRole('textbox', { name: 'Search projects' });
    act(() => useAppStore.getState().setProject(editingSnapshot));
    const note = await screen.findByRole('textbox', { name: 'Problem description' });
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
      expect.objectContaining({
        notes: expect.objectContaining({ problem: 'Latest note' }),
      }),
    );
    expect(useAppStore.getState().snapshot).toBeNull();
  });

  it('keeps the project and notes open when saving before search fails', async () => {
    const { save, note, editingSnapshot } = await renderEditingProject();
    fireEvent.change(note, { target: { value: 'Unsaved note' } });
    save.mockRejectedValueOnce(new Error('Workspace unavailable'));
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Search was cancelled');
    expect(useAppStore.getState().snapshot).toBe(editingSnapshot);
    expect(note).toHaveValue('Unsaved note');
    expect(screen.queryByRole('textbox', { name: 'Search projects' })).not.toBeInTheDocument();
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
    const { save, note } = await renderEditingProject({
      onUpdateStatus: (handler) => {
        emitUpdate = handler;
        return () => {};
      },
      installUpdate,
    });
    let finishSave!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
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
    const { save } = await renderEditingProject();
    let finishSave!: () => void;
    save.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
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
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Search projects/ }));
    fireEvent.change(note, { target: { value: 'Typed while saving' } });
    await act(async () => finishSave());
    expect(useAppStore.getState().snapshot).toBe(editingSnapshot);
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

  it('focuses the subfolder name and submits its modal form', async () => {
    let finishCreate!: (result: ProjectSnapshot) => void;
    const editRound = vi.fn(
      () =>
        new Promise<ProjectSnapshot>((resolve) => {
          finishCreate = resolve;
        }),
    );
    window.imnota = { editRound } as unknown as ImnotaBridge;
    useAppStore.setState({ snapshot, activeRoundId: '001-first-feedback' });
    render(<RoundControls onFlush={vi.fn(async () => {})} />);

    fireEvent.click(screen.getByRole('button', { name: 'New subfolder' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Subfolder name' });
    expect(name).toHaveFocus();
    fireEvent.change(name, { target: { value: 'Second feedback' } });
    fireEvent.submit(name.closest('form')!);

    await waitFor(() =>
      expect(editRound).toHaveBeenCalledWith({
        projectPath: '/workspace/project',
        roundId: '001-first-feedback',
        action: 'create',
        name: 'Second feedback',
      }),
    );
    expect(name).toBeDisabled();
    fireEvent.submit(name.closest('form')!);
    expect(editRound).toHaveBeenCalledOnce();
    await act(async () => finishCreate(snapshot));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
