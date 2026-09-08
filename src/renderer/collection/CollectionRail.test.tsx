import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImnotaBridge, ProjectSnapshot, ScreenshotRecord } from '../../shared/types';
import { useAppStore } from '../store';
import { CollectionRail, type CollectionRailProps } from './CollectionRail';

function screenshot(
  id: string,
  collectionId: string,
  position: number,
  includeInExport = true,
): ScreenshotRecord {
  return {
    id,
    collectionId,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: `${id} title`,
    description: '',
    position,
    createdAt: `2026-01-0${position + 1}T00:00:00.000Z`,
    updatedAt: `2026-01-0${position + 1}T00:00:00.000Z`,
    priority: 'medium',
    annotationFile: `collections/${collectionId}/annotations/${id}.png.json`,
    descriptionFile: `collections/${collectionId}/descriptions/${id}.png.md`,
    originalWidth: 1280,
    originalHeight: 720,
    includeInExport,
  };
}

function projectSnapshot(): ProjectSnapshot {
  return {
    projectPath: '/workspace/project',
    thumbnails: {},
    recoveryFound: false,
    projectRevision: 'project-1',
    project: {
      schemaVersion: 3,
      id: 'project-id',
      name: 'Collection verification',
      description: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      status: 'active',
      favourite: false,
      collections: [
        {
          id: 'collection-a',
          name: 'Collection A',
          archived: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          overallContext: '',
        },
        {
          id: 'collection-b',
          name: 'Collection B',
          archived: false,
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          overallContext: '',
        },
      ],
      screenshots: [
        screenshot('alpha', 'collection-a', 0),
        screenshot('beta', 'collection-a', 1, false),
        screenshot('gamma', 'collection-a', 2),
        screenshot('outside', 'collection-b', 7),
      ],
      exportPreferences: {
        includeOriginalScreenshots: true,
        includeAnnotationMetadata: true,
        template: 'default',
      },
    },
  };
}

function props(overrides: Partial<CollectionRailProps> = {}): CollectionRailProps {
  return {
    onFlush: vi.fn(async () => true),
    onSaveProject: vi.fn(async () => true),
    onUpdateProject: vi.fn(),
    onSelectScreenshot: vi.fn(),
    onSelectCollection: vi.fn(),
    onImport: vi.fn(),
    onPaste: vi.fn(),
    onMessage: vi.fn(),
    onSnapshot: vi.fn((snapshot, selectedId) => {
      useAppStore.getState().setProject(snapshot);
      if (selectedId) useAppStore.getState().set({ activeScreenshotId: selectedId });
    }),
    ...overrides,
  };
}

function row(id: string): HTMLElement {
  const item = screen.getByTestId(`screenshot-${id}`).closest('.shot-item');
  if (!item) throw new Error(`Screenshot row ${id} was not rendered.`);
  return item as HTMLElement;
}

beforeEach(() => {
  localStorage.clear();
  const snapshot = projectSnapshot();
  useAppStore.setState({
    snapshot,
    activeCollectionId: 'collection-a',
    activeScreenshotId: 'alpha',
    leftPanelOpen: true,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useAppStore.setState({
    snapshot: null,
    activeCollectionId: '001-collection',
    activeScreenshotId: null,
    leftPanelOpen: true,
  });
});

describe('CollectionRail', () => {
  it('admits one collection operation while its preflight save is pending', async () => {
    let finishFlush!: (saved: boolean) => void;
    const onFlush = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishFlush = resolve;
        }),
    );
    const editCollection = vi.fn(async () => projectSnapshot());
    window.imnota = { editCollection } as unknown as ImnotaBridge;
    render(<CollectionRail {...props({ onFlush })} />);
    const create = screen.getByRole('button', { name: 'New collection' });
    fireEvent.click(create);
    fireEvent.click(create);
    expect(onFlush).toHaveBeenCalledOnce();
    expect(editCollection).not.toHaveBeenCalled();
    expect(create).toBeDisabled();
    await act(async () => finishFlush(true));
    await waitFor(() => expect(editCollection).toHaveBeenCalledOnce());
    expect(create).toBeEnabled();
  });

  it.each(['blocked', 'rejected'])('allows retry after a %s preflight save', async (failure) => {
    const onFlush = vi.fn(async () => true);
    if (failure === 'blocked') onFlush.mockResolvedValueOnce(false);
    else onFlush.mockRejectedValueOnce(new Error('Save unavailable'));
    const editCollection = vi.fn(async () => projectSnapshot());
    window.imnota = { editCollection } as unknown as ImnotaBridge;
    render(<CollectionRail {...props({ onFlush })} />);
    const create = screen.getByRole('button', { name: 'New collection' });
    fireEvent.click(create);
    await waitFor(() => expect(create).toBeEnabled());
    expect(editCollection).not.toHaveBeenCalled();
    if (failure === 'rejected') expect(screen.getByRole('alert')).toHaveTextContent('Save unavailable');
    fireEvent.click(create);
    await waitFor(() => expect(editCollection).toHaveBeenCalledOnce());
    expect(onFlush).toHaveBeenCalledTimes(2);
  });

  it('applies visibility to the selected conflict copy after flushing', async () => {
    const current = projectSnapshot();
    const text = {
      id: 'text',
      kind: 'text' as const,
      collectionId: 'collection-a',
      position: 4,
      includeInExport: true,
      createdAt: 'now',
      updatedAt: 'now',
      markdownFilename: 'text.md',
    };
    current.project.contentItems = [text];
    useAppStore.setState({ snapshot: current, activeScreenshotId: text.id });
    const onFlush = vi.fn(async () => {
      useAppStore.setState({
        snapshot: {
          ...current,
          project: {
            ...current.project,
            contentItems: [
              text,
              {
                ...text,
                id: 'conflict',
                position: 5,
                markdownFilename: 'conflict.md',
                includeInExport: false,
              },
            ],
          },
        },
        activeScreenshotId: 'conflict',
      });
      return true;
    });
    const onSaveProject = vi.fn(async () => true);
    render(<CollectionRail {...props({ onFlush, onSaveProject })} />);
    fireEvent.click(screen.getByTestId('screenshot-export-toggle-text'));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledOnce());
    const saved = useAppStore.getState().snapshot!.project.contentItems!;
    expect(saved.find((item) => item.id === 'text')?.includeInExport).toBe(true);
    expect(saved.find((item) => item.id === 'conflict')?.includeInExport).toBe(true);
  });
  it('orders text and drawings with screenshots and reorders them by keyboard', async () => {
    const current = projectSnapshot();
    current.project.contentItems = [
      {
        id: 'text',
        kind: 'text',
        collectionId: 'collection-a',
        position: 0.5,
        includeInExport: true,
        createdAt: 'now',
        updatedAt: 'now',
        markdownFilename: 'text.md',
        preview: 'Architecture overview',
      },
      {
        id: 'drawing',
        kind: 'drawing',
        collectionId: 'collection-a',
        position: 1.5,
        includeInExport: true,
        createdAt: 'now',
        updatedAt: 'now',
        title: 'Services',
        sourceFilename: 'drawing.json',
        imageFilename: 'drawing.png',
        originalWidth: 100,
        originalHeight: 100,
      },
    ];
    useAppStore.setState({ snapshot: current });
    const onSaveProject = vi.fn(async () => true);
    render(<CollectionRail {...props({ onSaveProject, onAddContent: vi.fn() })} />);
    const ids = () =>
      [...screen.getByLabelText('Content sequence').querySelectorAll('.shot-select')].map((element) =>
        element.getAttribute('data-testid'),
      );
    expect(ids()).toEqual([
      'screenshot-alpha',
      'screenshot-text',
      'screenshot-beta',
      'screenshot-drawing',
      'screenshot-gamma',
    ]);
    fireEvent.keyDown(screen.getByTestId('screenshot-text'), { key: 'ArrowUp', altKey: true });
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledOnce());
    expect(ids()[0]).toBe('screenshot-text');
    expect(
      useAppStore.getState().snapshot?.project.contentItems?.find((item) => item.id === 'text')?.position,
    ).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    expect(screen.getByRole('menu', { name: 'Add item' })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Drawing/ })).toBeVisible();
    expect(screen.getByRole('menuitem', { name: /Text block/ })).toBeVisible();
  });

  it('keeps the Add item menu keyboard navigable and restores focus after dismissal', async () => {
    const onImport = vi.fn();
    const onAddContent = vi.fn();
    render(<CollectionRail {...props({ onImport, onAddContent })} />);

    const trigger = screen.getByRole('button', { name: 'Add item' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const screenshot = await screen.findByTestId('add-item-screenshot');
    await waitFor(() => expect(screenshot).toHaveFocus());

    fireEvent.keyDown(screenshot, { key: 'End' });
    const text = screen.getByTestId('add-item-text');
    await waitFor(() => expect(text).toHaveFocus());
    fireEvent.keyDown(text, { key: 'Home' });
    await waitFor(() => expect(screenshot).toHaveFocus());
    fireEvent.keyDown(screenshot, { key: 'ArrowUp' });
    await waitFor(() => expect(text).toHaveFocus());
    fireEvent.keyDown(text, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(trigger, { key: 'ArrowUp' });
    await waitFor(() => expect(screen.getByTestId('add-item-text')).toHaveFocus());
    fireEvent.click(screen.getByTestId('add-item-drawing'));
    expect(onAddContent).toHaveBeenCalledWith('drawing');
    expect(onImport).not.toHaveBeenCalled();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([false, true])(
    'closes both popovers after focus leaves with Tab (reverse=%s)',
    async (shiftKey) => {
      render(<CollectionRail {...props()} />);
      const destination = screen.getByRole('button', { name: /Paste from clipboard/i });
      for (const [trigger, role] of [
        [screen.getByRole('button', { name: 'Collection' }), 'listbox'],
        [screen.getByRole('button', { name: 'Add item' }), 'menu'],
      ] as const) {
        fireEvent.keyDown(trigger, { key: 'ArrowDown' });
        const popup = await screen.findByRole(role);
        await waitFor(() => expect(popup.contains(document.activeElement)).toBe(true));
        fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey });
        // jsdom does not perform browser Tab traversal: model the resulting focus move.
        act(() => destination.focus());
        expect(screen.queryByRole(role)).not.toBeInTheDocument();
        expect(trigger).toHaveAttribute('aria-expanded', 'false');
        expect(destination).toHaveFocus();
      }
    },
  );

  it('opens collection keyboard endpoints at the requested option', async () => {
    render(<CollectionRail {...props()} />);
    const trigger = screen.getByRole('button', { name: 'Collection' });
    for (const [key, name] of [
      ['End', 'Collection B'],
      ['Home', 'Collection A'],
      ['ArrowUp', 'Collection B'],
    ] as const) {
      fireEvent.keyDown(trigger, { key });
      await waitFor(() => expect(screen.getByRole('option', { name })).toHaveFocus());
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await waitFor(() => expect(trigger).toHaveFocus());
    }
  });

  it('excludes a text block without altering screenshots', async () => {
    const current = projectSnapshot();
    current.project.contentItems = [
      {
        id: 'text',
        kind: 'text',
        collectionId: 'collection-a',
        position: 4,
        includeInExport: true,
        createdAt: 'now',
        updatedAt: 'now',
        markdownFilename: 'text.md',
      },
    ];
    useAppStore.setState({ snapshot: current });
    const onSaveProject = vi.fn(async () => true);
    render(<CollectionRail {...props({ onSaveProject })} />);
    fireEvent.click(screen.getByTestId('screenshot-export-toggle-text'));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledOnce());
    expect(useAppStore.getState().snapshot?.project.contentItems?.[0].includeInExport).toBe(false);
    expect(useAppStore.getState().snapshot?.project.screenshots).toEqual(current.project.screenshots);
  });
  it('archives and restores the current collection through snapshot adoption', async () => {
    const editCollection = vi.fn<ImnotaBridge['editCollection']>(async (input) => {
      const current = useAppStore.getState().snapshot!;
      return {
        ...current,
        projectRevision: input.action === 'archive' ? 'project-2' : 'project-3',
        project: {
          ...current.project,
          collections: current.project.collections.map((collection) =>
            collection.id === input.collectionId
              ? { ...collection, archived: input.action === 'archive' }
              : collection,
          ),
        },
      };
    });
    window.imnota = { editCollection } as unknown as ImnotaBridge;
    const onSnapshot = vi.fn<CollectionRailProps['onSnapshot']>((snapshot, selectedId) => {
      useAppStore.getState().setProject(snapshot);
      if (selectedId) useAppStore.getState().set({ activeScreenshotId: selectedId });
    });
    const railProps = props({ onSnapshot });
    render(<CollectionRail {...railProps} />);

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await screen.findByRole('button', { name: 'Restore' });
    expect(editCollection).toHaveBeenNthCalledWith(1, {
      projectPath: '/workspace/project',
      collectionId: 'collection-a',
      action: 'archive',
      name: undefined,
    });
    expect(onSnapshot).toHaveBeenNthCalledWith(1, expect.any(Object), 'alpha');
    expect(useAppStore.getState().snapshot?.project.collections[0].archived).toBe(true);
    expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /paste from clipboard/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled());
    expect(editCollection).toHaveBeenNthCalledWith(2, {
      projectPath: '/workspace/project',
      collectionId: 'collection-a',
      action: 'restore',
      name: undefined,
    });
    expect(onSnapshot).toHaveBeenNthCalledWith(2, expect.any(Object), 'alpha');
    const restored = useAppStore.getState().snapshot!.project;
    expect(restored.collections[0].archived).toBe(false);
    expect(restored.collections.map((collection) => collection.id)).toEqual(['collection-a', 'collection-b']);
    expect(restored.screenshots.map((item) => item.id)).toEqual(['alpha', 'beta', 'gamma', 'outside']);
  });

  it('keeps the selected collection focused through complete picker keyboard navigation', async () => {
    const snapshot = projectSnapshot();
    snapshot.project.collections = Array.from({ length: 14 }, (_, index) => ({
      id: `collection-${index}`,
      name: `Collection ${index + 1}`,
      archived: index > 8,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: `2026-01-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      overallContext: '',
    }));
    useAppStore.setState({ snapshot, activeCollectionId: 'collection-0' });
    const onSelectCollection = vi.fn();
    render(<CollectionRail {...props({ onSelectCollection })} />);

    const trigger = screen.getByTestId('collection-picker');
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const options = await screen.findAllByRole('option');
    await waitFor(() => expect(options[0]).toHaveFocus());

    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    await waitFor(() => expect(options[1]).toHaveFocus());
    fireEvent.keyDown(options[1], { key: 'Home' });
    await waitFor(() => expect(options[0]).toHaveFocus());
    fireEvent.keyDown(options[0], { key: 'End' });
    await waitFor(() => expect(options.at(-1)).toHaveFocus());
    fireEvent.keyDown(options.at(-1)!, { key: ' ' });

    expect(onSelectCollection).toHaveBeenCalledWith('collection-13');
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.keyDown(trigger, { key: 'Enter' });
    await screen.findAllByRole('option');
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('reorders screenshots through drag and drop while preserving IDs and normalized positions', async () => {
    const onSaveProject = vi.fn<CollectionRailProps['onSaveProject']>(async () => true);
    render(<CollectionRail {...props({ onSaveProject })} />);

    fireEvent.dragStart(row('alpha'));
    fireEvent.dragOver(row('gamma'));
    fireEvent.drop(row('gamma'));

    await waitFor(() => expect(onSaveProject).toHaveBeenCalledOnce());
    const saved = onSaveProject.mock.calls[0][0];
    expect(new Set(saved.screenshots.map((item) => item.id))).toEqual(
      new Set(['alpha', 'beta', 'gamma', 'outside']),
    );
    expect(
      saved.screenshots
        .filter((item) => item.collectionId === 'collection-a')
        .sort((left, right) => left.position - right.position)
        .map((item) => [item.id, item.position]),
    ).toEqual([
      ['beta', 0],
      ['gamma', 1],
      ['alpha', 2],
    ]);
    expect(saved.screenshots.find((item) => item.id === 'outside')?.position).toBe(7);
    expect(useAppStore.getState().snapshot?.project).toBe(saved);
    expect(screen.getByTestId('screenshot-beta')).toHaveTextContent('01');
    expect(screen.getByTestId('screenshot-gamma')).toHaveTextContent('02');
    expect(screen.getByTestId('screenshot-alpha')).toHaveTextContent('03');
  });

  it('keeps an excluded row selectable and toggles its prompt inclusion in both directions', async () => {
    const onSelectScreenshot = vi.fn();
    const onSaveProject = vi.fn<CollectionRailProps['onSaveProject']>(async () => true);
    render(<CollectionRail {...props({ onSelectScreenshot, onSaveProject })} />);

    expect(row('beta')).toHaveClass('excluded');
    fireEvent.click(screen.getByTestId('screenshot-beta'));
    expect(onSelectScreenshot).toHaveBeenCalledWith('beta');

    fireEvent.click(screen.getByRole('button', { name: 'Include beta title in prompt' }));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledTimes(1));
    expect(
      useAppStore.getState().snapshot?.project.screenshots.find((item) => item.id === 'beta'),
    ).toMatchObject({ id: 'beta', includeInExport: true, position: 1 });
    expect(row('beta')).not.toHaveClass('excluded');

    fireEvent.click(screen.getByRole('button', { name: 'Exclude beta title from prompt' }));
    await waitFor(() => expect(onSaveProject).toHaveBeenCalledTimes(2));
    expect(
      useAppStore.getState().snapshot?.project.screenshots.find((item) => item.id === 'beta'),
    ).toMatchObject({ id: 'beta', includeInExport: false, position: 1 });
    expect(row('beta')).toHaveClass('excluded');
  });
});
