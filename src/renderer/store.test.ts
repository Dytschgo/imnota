import { beforeEach, expect, it } from 'vitest';
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
  useAppStore.setState({ snapshot: null, activeCollectionId: '001-collection', activeScreenshotId: null });
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
