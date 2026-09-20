import { describe, expect, it } from 'vitest';
import type { ProjectListItem, ProjectSnapshot } from '../../shared/types';
import {
  captureDestinationChoices,
  currentCaptureDestination,
  lastUsedCurrentDestination,
  resolveCaptureDestination,
} from './capture-destination';

const collection = {
  id: '001-collection',
  name: 'Workspace',
  archived: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  overallContext: '',
};

const snapshot = {
  projectPath: '/workspace/project',
  thumbnails: {},
  recoveryFound: false,
  project: {
    schemaVersion: 3 as const,
    id: 'project-id',
    name: 'Project',
    description: '',
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    status: 'active' as const,
    favourite: false,
    collections: [collection],
    screenshots: [],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      template: 'default' as const,
    },
  },
} satisfies ProjectSnapshot;

const project: ProjectListItem = {
  projectPath: snapshot.projectPath,
  id: snapshot.project.id,
  name: snapshot.project.name,
  description: '',
  createdAt: collection.createdAt,
  updatedAt: collection.updatedAt,
  status: 'active',
  favourite: false,
  collections: [collection],
  screenshots: [],
};

describe('capture destination', () => {
  it('uses the current collection when it is still a live collection', () => {
    expect(currentCaptureDestination(snapshot, '001-collection')).toEqual({
      projectPath: '/workspace/project',
      collectionId: '001-collection',
    });
    expect(currentCaptureDestination(snapshot, 'missing')).toBeNull();
    expect(
      currentCaptureDestination(
        {
          ...snapshot,
          project: { ...snapshot.project, collections: [{ ...collection, archived: true }] },
        },
        '001-collection',
      ),
    ).toBeNull();
  });

  it('restores the last-used current collection and otherwise lists remaining choices', () => {
    const archived = { ...collection, id: 'archived', name: 'Old', archived: true };
    const other = { ...collection, id: '002-collection', name: 'Review' };
    const recents = [
      {
        projectPath: snapshot.projectPath,
        collectionId: 'archived',
        openedAt: '2026-02-01T00:00:00.000Z',
      },
      {
        projectPath: snapshot.projectPath,
        collectionId: '002-collection',
        openedAt: '2026-01-01T00:00:00.000Z',
      },
    ];
    const projects = [{ ...project, collections: [archived, other] }];
    expect(lastUsedCurrentDestination(projects, recents)).toEqual({
      projectPath: snapshot.projectPath,
      collectionId: '002-collection',
    });
    expect(
      resolveCaptureDestination(
        { ...snapshot, project: { ...snapshot.project, collections: [archived, other] } },
        'archived',
        projects,
        recents,
      ),
    ).toEqual({ projectPath: snapshot.projectPath, collectionId: '002-collection' });
    expect(
      captureDestinationChoices(projects, [], {
        ...snapshot,
        project: { ...snapshot.project, collections: [archived, other] },
      }).map((choice) => choice.collectionId),
    ).toEqual(['002-collection']);
  });
});
