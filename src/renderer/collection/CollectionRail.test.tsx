import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    expect(screen.getByRole('button', { name: /add screenshots/i })).toBeDisabled();
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
