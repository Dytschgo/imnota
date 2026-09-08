import { beforeEach, expect, it, vi } from 'vitest';
import { emptyProject } from '../shared/utils';
import {
  HISTORY_KEY,
  readCollectionHistory,
  rememberCollection,
  resolveRecentCollections,
  relativeOpenedTime,
} from './navigation-history';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it('keeps most recent visits first, deduplicates by path and collection, and bounds persistence', () => {
  let history = rememberCollection([], '/a', 'one', '2026-01-01');
  history = rememberCollection(history, '/b', 'one', '2026-01-02');
  history = rememberCollection(history, '/a', 'one', '2026-01-03');
  expect(history.map((entry) => entry.projectPath)).toEqual(['/a', '/b']);
  expect(readCollectionHistory()).toEqual(history);
  for (let index = 0; index < 120; index++) history = rememberCollection(history, '/a', String(index));
  expect(readCollectionHistory()).toHaveLength(100);
});

it('ignores corrupt storage and works when storage is unavailable', () => {
  localStorage.setItem(HISTORY_KEY, '{broken');
  expect(readCollectionHistory()).toEqual([]);
  localStorage.setItem(
    HISTORY_KEY,
    JSON.stringify([null, {}, { projectPath: '/a', collectionId: 'c', openedAt: 'bad' }]),
  );
  expect(readCollectionHistory()).toEqual([]);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Unavailable');
  });
  expect(rememberCollection([], '/a', 'c')).toHaveLength(1);
});

it('resolves current names only in known projects and excludes missing and archived collections', () => {
  const project = { ...emptyProject('Renamed project', ''), projectPath: '/a' };
  const collection = project.collections[0];
  const history = rememberCollection([], '/a', collection.id);
  expect(resolveRecentCollections([project], history)[0]).toMatchObject({
    projectName: 'Renamed project',
    name: collection.name,
  });
  expect(resolveRecentCollections([], history)).toEqual([]);
  collection.archived = true;
  expect(resolveRecentCollections([project], history)).toEqual([]);
});

it('formats opened time without negative ages', () => {
  const now = Date.parse('2026-09-08T12:00:00Z');
  expect(relativeOpenedTime('2026-09-08T13:00:00Z', now)).toBe('Just opened');
  expect(relativeOpenedTime('2026-09-08T11:00:00Z', now)).toBe('Opened 1h ago');
});
