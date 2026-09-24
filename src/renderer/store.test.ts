import { beforeEach, expect, it } from 'vitest';
import { projectListItem } from '../shared/project-list';
import type { ProjectSnapshot, ScreenshotRecord } from '../shared/types';
import { emptyProject } from '../shared/utils';
import { useAppStore } from './store';

function shot(id: string, collectionId: string, position: number): ScreenshotRecord {
  return {
    collectionId,
    id,
    originalFilename: `${id}.png`,
    storedFilename: `${id}.png`,
    title: id,
    description: '',
    position,
    createdAt: id,
    updatedAt: id,
    priority: 'medium',
    annotationFile: `collections/${collectionId}/annotations/${id}.png.json`,
    descriptionFile: `collections/${collectionId}/descriptions/${id}.png.md`,
    originalWidth: 10,
    originalHeight: 10,
    includeInExport: true,
  };
}

function snapshot(): ProjectSnapshot {
  const project = emptyProject('Project', '');
  project.collections.push({
    id: '002-collection',
    name: 'Workspace / Collection 02',
    archived: false,
    createdAt: '2026-02-01',
    updatedAt: '2026-02-01',
    overallContext: '',
  });
  project.screenshots = [shot('later', '002-collection', 1), shot('first', '002-collection', 0)];
  return { projectPath: '/workspace/project', project, thumbnails: {}, recoveryFound: false };
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({
    projects: [],
    snapshot: null,
    activeCollectionId: '001-collection',
    activeScreenshotId: null,
    recentCollections: [],
  });
});

it('keeps project-list entries display-only after a project edit', () => {
  const value = snapshot();
  useAppStore.getState().setProject(value);
  useAppStore.getState().set({ projects: [projectListItem(value.projectPath, value.project)] });
  const project = {
    ...value.project,
    name: 'Updated name',
    description: 'Searchable update',
    contentItems: [
      {
        id: 'text',
        kind: 'text' as const,
        collectionId: '002-collection',
        position: 2,
        includeInExport: true,
        createdAt: '2020',
        updatedAt: '2020',
        markdownFilename: 'text.md',
        preview: 'Orbital lantern',
      },
    ],
  };
  useAppStore.getState().updateProject(project);
  const item = useAppStore.getState().projects[0]!;
  expect(item.projectPath).toBe(value.projectPath);
  expect(item.name).toBe('Updated name');
  expect(item.searchText).toContain('orbital lantern');
  expect(item.searchText).toContain('searchable update');
  expect(item).not.toHaveProperty('schemaVersion');
  expect(item).not.toHaveProperty('contentItems');
  expect(item).not.toHaveProperty('exportPreferences');
  expect(item.screenshots).toEqual([{ id: 'later' }, { id: 'first' }]);
  expect(Object.keys(item.collections[0]!).sort()).toEqual([
    'archived',
    'createdAt',
    'id',
    'name',
    'updatedAt',
  ]);
  expect(useAppStore.getState().snapshot?.project).toBe(project);
});

it('updates sidebar collections immediately when authoritative snapshots archive and restore them', () => {
  const original = snapshot();
  useAppStore.getState().set({ projects: [projectListItem(original.projectPath, original.project)] });
  for (const archived of [true, false]) {
    const next = structuredClone(original);
    next.project.collections[0]!.archived = archived;
    useAppStore.getState().setProject(next);
    expect(useAppStore.getState().projects[0]!.collections[0]!.archived).toBe(archived);
    expect(useAppStore.getState().projects[0]).not.toHaveProperty('contentItems');
  }
});

it('remembers the last opened collection locally and selects its first sorted screenshot on reopen', () => {
  const value = snapshot();
  useAppStore.getState().setProject(value);
  useAppStore.getState().setActiveCollection('002-collection');
  expect(useAppStore.getState().activeScreenshotId).toBe('first');
  useAppStore.getState().setProject(null);
  useAppStore.getState().setProject(value);
  expect(useAppStore.getState().activeCollectionId).toBe('002-collection');
  expect(useAppStore.getState().activeScreenshotId).toBe('first');
});

it('keeps the selected screenshot when the current project snapshot is refreshed', () => {
  const value = snapshot();
  useAppStore.getState().setProject(value);
  useAppStore.getState().setActiveCollection('002-collection');
  useAppStore.getState().set({ activeScreenshotId: 'later' });

  useAppStore.getState().setProject({
    ...value,
    project: { ...value.project, favourite: true, updatedAt: '2026-02-02' },
  });

  expect(useAppStore.getState().activeScreenshotId).toBe('later');
});

it('records explicit collection navigation but does not reorder history on autosave refreshes', () => {
  const value = snapshot();
  useAppStore.getState().setProject(value);
  useAppStore.getState().setActiveCollection('002-collection');
  const history = useAppStore.getState().recentCollections;
  expect(history[0]).toMatchObject({ projectPath: value.projectPath, collectionId: '002-collection' });
  useAppStore.getState().setProject({ ...value, projectRevision: 'saved' });
  expect(useAppStore.getState().recentCollections).toBe(history);
  useAppStore.getState().setActiveCollection('missing');
  expect(useAppStore.getState().recentCollections).toBe(history);
});

it('selects the restored item and its collection atomically after Undo elsewhere', () => {
  const value = snapshot();
  value.project.contentItems = [
    {
      id: 'restored',
      kind: 'text',
      collectionId: '002-collection',
      position: 2,
      includeInExport: true,
      createdAt: '2020',
      updatedAt: '2020',
      markdownFilename: 'restored.md',
    },
  ];
  useAppStore.getState().setProject(value);
  expect(useAppStore.getState().activeCollectionId).toBe('001-collection');
  useAppStore.getState().setProject(value, 'restored');
  expect(useAppStore.getState().activeCollectionId).toBe('002-collection');
  expect(useAppStore.getState().activeScreenshotId).toBe('restored');
});

it('restores a text-first collection and preserves drawing selection through autosave snapshots', () => {
  const value = snapshot();
  value.project.contentItems = [
    {
      id: 'intro',
      kind: 'text',
      collectionId: '002-collection',
      position: 0,
      includeInExport: true,
      createdAt: '2020',
      updatedAt: '2020',
      markdownFilename: 'intro.md',
    },
    {
      id: 'architecture',
      kind: 'drawing',
      collectionId: '002-collection',
      position: 3,
      includeInExport: true,
      createdAt: '2020',
      updatedAt: '2020',
      title: 'Architecture',
      sourceFilename: 'architecture.json',
      imageFilename: 'architecture.png',
      originalWidth: 160,
      originalHeight: 120,
    },
  ];
  value.project.screenshots = value.project.screenshots.map((item) => ({
    ...item,
    position: item.position + 1,
  }));
  useAppStore.getState().setProject(value);
  useAppStore.getState().setActiveCollection('002-collection');
  expect(useAppStore.getState().activeScreenshotId).toBe('intro');
  expect(useAppStore.getState().activeScreenshot()).toBeNull();
  useAppStore.getState().set({ activeScreenshotId: 'architecture' });
  useAppStore.getState().setProject({ ...value, projectRevision: 'new' });
  expect(useAppStore.getState().activeScreenshotId).toBe('architecture');
});
