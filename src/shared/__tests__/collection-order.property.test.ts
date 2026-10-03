// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { addEmptyCollection } from '../../../electron/collections.js';
import { preserveMixedProjectMetadata } from '../../../electron/content-project-metadata.js';
import { currentProject, plainRecordId, portableKey, schemaName } from '../../test/project-arbitraries.js';
import { runs } from '../../test/property.js';
import { orderedCollectionItems } from '../content-items.js';
import { orderedCollectionItems as orderedExportItems } from '../markdown.js';
import { validateProject } from '../schema.js';
import type { ProjectData } from '../types.js';
import { emptyProject } from '../utils.js';

const orderedIds = (project: ProjectData, collectionId: string) =>
  orderedCollectionItems(project, collectionId).map((item) => item.id);

function memberIds(project: ProjectData, collectionId: string): string[] {
  return [...project.screenshots, ...(project.contentItems ?? [])]
    .filter((item) => item.collectionId === collectionId)
    .map((item) => item.id);
}

/**
 * The reorder the collection rail performs: move one item in the authoritative order, then give
 * every item of that collection its index as the new position.
 */
function reorder(project: ProjectData, collectionId: string, from: number, to: number): ProjectData {
  const ordered = orderedCollectionItems(project, collectionId);
  const [moved] = ordered.splice(from, 1);
  if (moved) ordered.splice(to, 0, moved);
  const positions = new Map(ordered.map((item, position) => [item.id, position]));
  return {
    ...project,
    screenshots: project.screenshots.map((item) => ({
      ...item,
      position: positions.get(item.id) ?? item.position,
    })),
    ...(project.contentItems
      ? {
          contentItems: project.contentItems.map((item) => ({
            ...item,
            position: positions.get(item.id) ?? item.position,
          })),
        }
      : {}),
  };
}

const projectAndCollection = (project: fc.Arbitrary<ProjectData>) =>
  project.chain((value) =>
    fc.record({
      project: fc.constant(value),
      collectionId: fc.constantFrom(...value.collections.map((entry) => entry.id)),
    }),
  );

describe('collection order properties', () => {
  it('returns exactly the items of the collection, sorted by position, the same way every time', () => {
    fc.assert(
      fc.property(projectAndCollection(currentProject()), ({ project, collectionId }) => {
        const before = JSON.stringify(project);
        const ordered = orderedCollectionItems(project, collectionId);
        expect(ordered.map((item) => item.id).sort()).toEqual(memberIds(project, collectionId).sort());
        expect(ordered.every((item) => item.collectionId === collectionId)).toBe(true);
        for (let index = 1; index < ordered.length; index++)
          expect(ordered[index]!.position).toBeGreaterThanOrEqual(ordered[index - 1]!.position);
        expect(orderedCollectionItems(project, collectionId)).toEqual(ordered);
        // Screenshots gain a discriminator; nothing else is added, dropped or rewritten.
        for (const item of ordered) {
          const source =
            item.kind === 'screenshot'
              ? { ...project.screenshots.find((entry) => entry.id === item.id)!, kind: 'screenshot' }
              : project.contentItems!.find((entry) => entry.id === item.id);
          expect(item).toEqual(source);
        }
        expect(JSON.stringify(project)).toBe(before);
      }),
      runs(200),
    );
  });

  it('does not depend on the storage order of the arrays for ordinary identifiers', () => {
    const shuffled = currentProject({ ids: plainRecordId }).chain((project) =>
      fc.record({
        project: fc.constant(project),
        screenshots: fc.shuffledSubarray(project.screenshots, { minLength: project.screenshots.length }),
        contentItems: fc.shuffledSubarray(project.contentItems ?? [], {
          minLength: project.contentItems?.length ?? 0,
        }),
      }),
    );
    fc.assert(
      fc.property(shuffled, ({ project, screenshots, contentItems }) => {
        const rearranged = { ...project, screenshots, ...(project.contentItems ? { contentItems } : {}) };
        for (const collection of project.collections)
          expect(orderedIds(rearranged, collection.id)).toEqual(orderedIds(project, collection.id));
      }),
      runs(200),
    );
  });

  // FINDING (not fixed here): the final tie-breaker uses `localeCompare`, which reports distinct
  // strings as equal when they differ only by ignorable or canonically equivalent code points.
  // `validateProject` treats these IDs as different (exact comparison), so a schema 3 project may
  // hold two screenshots with the same position and creation time whose relative order then
  // depends on their order inside project.json rather than on the documented deterministic
  // tie-break. Schema 4 is unaffected because mixed positions must be unique.
  it.fails('orders items with collation-equal IDs independently of storage order', () => {
    const project = emptyProject('Tie', '');
    const shot = (id: string, storedFilename: string) => ({
      collectionId: '001-collection',
      id,
      originalFilename: storedFilename,
      storedFilename,
      title: '',
      description: '',
      position: 0,
      createdAt: '',
      updatedAt: '',
      priority: 'medium' as const,
      annotationFile: `collections/001-collection/annotations/${storedFilename}.json`,
      descriptionFile: `collections/001-collection/descriptions/${storedFilename}.md`,
      originalWidth: 1,
      originalHeight: 1,
      includeInExport: true,
    });
    const first = shot('a', 'a.png');
    const second = shot('a\u0000', 'b.png');
    const forward = validateProject({ ...project, screenshots: [first, second] });
    const backward = validateProject({ ...project, screenshots: [second, first] });
    expect(orderedIds(forward, '001-collection')).toEqual(orderedIds(backward, '001-collection'));
  });

  it('is a fixed point once positions are renumbered from the order', () => {
    fc.assert(
      fc.property(projectAndCollection(currentProject()), ({ project, collectionId }) => {
        const expected = orderedIds(project, collectionId);
        const renumbered = reorder(project, collectionId, 0, 0);
        expect(orderedIds(renumbered, collectionId)).toEqual(expected);
        expect(orderedCollectionItems(renumbered, collectionId).map((item) => item.position)).toEqual(
          expected.map((_, index) => index),
        );
        expect(reorder(renumbered, collectionId, 0, 0)).toEqual(renumbered);
      }),
      runs(150),
    );
  });

  it('moves exactly one item on reorder and survives the native metadata save', () => {
    const nonEmpty = projectAndCollection(currentProject()).filter(
      ({ project, collectionId }) => memberIds(project, collectionId).length > 0,
    );
    fc.assert(
      fc.property(nonEmpty, fc.nat(), fc.nat(), ({ project, collectionId }, a, b) => {
        const before = orderedIds(project, collectionId);
        const from = a % before.length;
        const to = b % before.length;
        const expected = [...before];
        expected.splice(to, 0, ...expected.splice(from, 1));

        const next = reorder(project, collectionId, from, to);
        expect(orderedIds(next, collectionId)).toEqual(expected);
        // A permutation: nothing appears, disappears or changes collection.
        expect([...orderedIds(next, collectionId)].sort()).toEqual([...before].sort());
        for (const other of project.collections)
          if (other.id !== collectionId)
            expect(orderedCollectionItems(next, other.id)).toEqual(orderedCollectionItems(project, other.id));

        // The save path keeps native identity from `current` and takes order from the candidate.
        const saved = preserveMixedProjectMetadata(project, next);
        expect(orderedIds(saved, collectionId)).toEqual(expected);
        expect(saved.screenshots.map((item) => item.id)).toEqual(project.screenshots.map((item) => item.id));
        expect((saved.contentItems ?? []).map((item) => item.id)).toEqual(
          (project.contentItems ?? []).map((item) => item.id),
        );
        // Moving the item back restores the original order.
        expect(orderedIds(reorder(saved, collectionId, to, from), collectionId)).toEqual(before);
      }),
      runs(200),
    );
  });

  it('refuses metadata saves that add, drop or re-home content', () => {
    const populated = currentProject().filter((project) => project.screenshots.length > 0);
    fc.assert(
      fc.property(populated, fc.nat(2), (project, mutation) => {
        const candidate = JSON.parse(JSON.stringify(project)) as ProjectData;
        if (mutation === 0) candidate.screenshots.pop();
        else if (mutation === 1) candidate.screenshots[0]!.storedFilename += 'x';
        else candidate.screenshots[0]!.id += '-renamed';
        expect(() => preserveMixedProjectMetadata(project, candidate)).toThrow(Error);
      }),
      runs(100),
    );
  });

  it('gives the export adapter the same order with consecutive source indexes', () => {
    fc.assert(
      fc.property(projectAndCollection(currentProject()), ({ project, collectionId }) => {
        const shared = orderedCollectionItems(project, collectionId);
        const exported = orderedExportItems(project, collectionId);
        expect(exported.map((entry) => entry.item.id)).toEqual(shared.map((item) => item.id));
        expect(exported.map((entry) => entry.sourceIndex)).toEqual(shared.map((_, index) => index));
        expect(exported.map((entry) => entry.kind)).toEqual(shared.map((item) => item.kind));
        expect(exported.map((entry) => entry.position)).toEqual(shared.map((item) => item.position));
      }),
      runs(150),
    );
  });

  it('adds a collection without disturbing existing collections or their content', () => {
    fc.assert(
      fc.property(currentProject(), schemaName, (project, candidateId) => {
        fc.pre(!project.collections.some((entry) => portableKey(entry.id) === portableKey(candidateId)));
        const next = addEmptyCollection(project, 'Workspace', candidateId, '2026-10-03T00:00:00.000Z');
        expect(next.collections.map((entry) => entry.id)).toEqual([
          ...project.collections.map((entry) => entry.id),
          candidateId,
        ]);
        expect(next.collections.filter((entry) => !entry.archived).map((entry) => entry.id)).toEqual([
          candidateId,
        ]);
        expect(next.screenshots).toEqual(project.screenshots);
        expect(next.contentItems).toEqual(project.contentItems);
        expect(orderedCollectionItems(next, candidateId)).toEqual([]);
        expect(validateProject(next)).toEqual(next);
      }),
      runs(100),
    );
  });
});
