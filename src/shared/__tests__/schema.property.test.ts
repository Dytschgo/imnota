// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { currentProject, legacyFixture, portableKey } from '../../test/project-arbitraries.js';
import { runs } from '../../test/property.js';
import { parseProjectFile, validateLegacyProject, validateProject } from '../schema.js';
import type { ProjectData, ScreenshotRecord } from '../types.js';

function ids(project: ProjectData) {
  return {
    collections: project.collections.map((entry) => entry.id),
    screenshots: project.screenshots.map((entry) => [entry.id, entry.collectionId, entry.position]),
    contentItems: (project.contentItems ?? []).map((entry) => [entry.id, entry.collectionId, entry.position]),
  };
}

/** Runs a validator and requires either a value or an `Error`; anything else thrown is a defect. */
function outcome<T>(validate: () => T): { accepted: true; value: T } | { accepted: false; error: Error } {
  try {
    return { accepted: true, value: validate() };
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    return { accepted: false, error: error as Error };
  }
}

const junk = fc.anything({
  withBigInt: true,
  withDate: true,
  withMap: true,
  withSet: true,
  withNullPrototype: true,
  withObjectString: true,
  withTypedArray: true,
  withSparseArray: true,
  maxDepth: 4,
});

type Path = Array<string | number>;

function containerPaths(value: unknown, prefix: Path = []): Path[] {
  if (Array.isArray(value))
    return [prefix, ...value.flatMap((entry, index) => containerPaths(entry, [...prefix, index]))];
  if (value && typeof value === 'object')
    return [
      prefix,
      ...Object.entries(value).flatMap(([key, entry]) => containerPaths(entry, [...prefix, key])),
    ];
  return [];
}

/** Replaces or deletes one property somewhere inside a JSON clone of a valid document. */
function corrupted(document: fc.Arbitrary<unknown>): fc.Arbitrary<unknown> {
  return document.chain((original) => {
    const clone = JSON.parse(JSON.stringify(original)) as unknown;
    return fc
      .record({
        container: fc.constantFrom(...containerPaths(clone)),
        pick: fc.nat(),
        replacement: fc.option(junk, { nil: undefined, freq: 4 }),
        remove: fc.boolean(),
      })
      .map(({ container, pick, replacement, remove }) => {
        const copy = JSON.parse(JSON.stringify(original)) as unknown;
        let target = copy as Record<string | number, unknown>;
        for (const key of container) target = target[key] as Record<string | number, unknown>;
        const keys = Object.keys(target);
        if (!keys.length) return copy;
        const key = keys[pick % keys.length]!;
        if (remove) delete target[key];
        else target[key] = replacement;
        return copy;
      });
  });
}

describe('project schema properties', () => {
  it('accepts every generated current project unchanged, before and after a JSON round trip', () => {
    fc.assert(
      fc.property(currentProject(), (project) => {
        const validated = validateProject(project);
        expect(validated).toEqual(project);
        expect(ids(validated)).toEqual(ids(project));
        // Validation is idempotent, and what is written to project.json reads back identically.
        expect(validateProject(validated)).toEqual(validated);
        const reread = parseProjectFile(JSON.parse(JSON.stringify(validated)));
        expect(reread).toEqual(JSON.parse(JSON.stringify(validated)));
        expect(ids(reread as ProjectData)).toEqual(ids(project));
      }),
      runs(150),
    );
  });

  it('fills only documented defaults when optional fields are missing', () => {
    fc.assert(
      fc.property(currentProject(), (project) => {
        const sparse = JSON.parse(JSON.stringify(project)) as ProjectData;
        Reflect.deleteProperty(sparse, 'exportPreferences');
        for (const shot of sparse.screenshots) Reflect.deleteProperty(shot, 'includeInExport');
        for (const item of sparse.contentItems ?? [])
          if (item.kind === 'drawing') Reflect.deleteProperty(item, 'description');
        const validated = validateProject(sparse);
        expect(ids(validated)).toEqual(ids(project));
        expect(validated.screenshots.every((shot) => shot.includeInExport)).toBe(true);
        expect(validated.exportPreferences).toEqual({
          includeOriginalScreenshots: false,
          includeAnnotationMetadata: true,
          template: 'default',
        });
        for (const item of validated.contentItems ?? [])
          if (item.kind === 'drawing') expect(item.description).toBe('');
        expect(validateProject(validated)).toEqual(validated);
      }),
      runs(75),
    );
  });

  it('accepts every generated legacy project and re-validates its own output', () => {
    fc.assert(
      fc.property(legacyFixture(), ({ project }) => {
        const validated = validateLegacyProject(project);
        expect(validated.screenshots.map((shot) => shot.id)).toEqual(
          (project.screenshots as Array<{ id: string }>).map((shot) => shot.id),
        );
        expect(validateLegacyProject(validated)).toEqual(validated);
        expect(parseProjectFile(project)).toEqual(validated);
      }),
      runs(100),
    );
  });

  it('rejects arbitrary junk with an Error and never returns it as a project', () => {
    fc.assert(
      fc.property(junk, (value) => {
        for (const validate of [parseProjectFile, validateProject, validateLegacyProject]) {
          const result = outcome(() => validate(value));
          expect(result.accepted).toBe(false);
        }
      }),
      runs(300),
    );
  });

  it('rejects junk dressed up with a supported schema version', () => {
    fc.assert(
      fc.property(fc.constantFrom(1, 2, 3, 4), fc.dictionary(fc.string(), junk), (schemaVersion, rest) => {
        const result = outcome(() => parseProjectFile({ ...rest, schemaVersion }));
        expect(result.accepted).toBe(false);
      }),
      runs(200),
    );
  });

  it('rejects unknown schema versions instead of rewriting them', () => {
    fc.assert(
      fc.property(
        currentProject(),
        fc.oneof(
          fc.integer().filter((version) => version < 1 || version > 4),
          fc.double().filter((version) => ![1, 2, 3, 4].includes(version)),
          fc.string(),
          fc.constantFrom(null, undefined, '3', '4', 3.5, [4], { version: 4 }),
        ),
        (project, schemaVersion) => {
          const result = outcome(() => parseProjectFile({ ...project, schemaVersion }));
          expect(result.accepted).toBe(false);
        },
      ),
      runs(150),
    );
  });

  it('either rejects a corrupted current project or returns a self-consistent one', () => {
    fc.assert(
      fc.property(corrupted(currentProject({ maxItems: 5 })), (document) => {
        const result = outcome(() => parseProjectFile(document));
        if (!result.accepted) return;
        // Whatever survives must be stable: a second pass cannot change or reject it.
        expect(parseProjectFile(result.value)).toEqual(result.value);
        expect(parseProjectFile(JSON.parse(JSON.stringify(result.value)))).toEqual(
          JSON.parse(JSON.stringify(result.value)),
        );
      }),
      runs(300),
    );
  });

  it('either rejects a corrupted legacy project or returns a self-consistent one', () => {
    fc.assert(
      fc.property(corrupted(legacyFixture().map((fixture) => fixture.project)), (document) => {
        const result = outcome(() => parseProjectFile(document));
        if (result.accepted) expect(parseProjectFile(result.value)).toEqual(result.value);
      }),
      runs(200),
    );
  });

  it('rejects structural corruption that would lose or alias user content', () => {
    const withTwoItems = currentProject({ version: 4 }).filter(
      (project) => project.screenshots.length >= 2 && (project.contentItems?.length ?? 0) >= 1,
    );
    fc.assert(
      fc.property(withTwoItems, fc.nat(6), (project, mutation) => {
        const broken = JSON.parse(JSON.stringify(project)) as ProjectData;
        const [first, second] = broken.screenshots as [ScreenshotRecord, ScreenshotRecord];
        const item = broken.contentItems![0]!;
        if (mutation === 0) second.id = first.id;
        else if (mutation === 1) first.collectionId = `${first.collectionId}-missing`;
        else if (mutation === 2) first.annotationFile = second.annotationFile;
        else if (mutation === 3) item.id = first.id;
        else if (mutation === 4) item.collectionId = `${item.collectionId}-missing`;
        else if (mutation === 5) broken.collections.push({ ...broken.collections[0]! });
        else {
          // Two stored names that differ only by case alias one file on Windows and macOS.
          second.collectionId = first.collectionId;
          second.storedFilename = first.storedFilename.toUpperCase();
          // Unicode uppercase can expand into a different lowercase path (e.g. Greek
          // characters with iota subscript). Only an actual alias must be refused.
          fc.pre(portableKey(second.storedFilename) === portableKey(first.storedFilename));
          second.annotationFile = `collections/${second.collectionId}/annotations/${second.storedFilename}.json`;
          second.descriptionFile = `collections/${second.collectionId}/descriptions/${second.storedFilename}.md`;
        }
        expect(outcome(() => validateProject(broken)).accepted).toBe(false);
      }),
      runs(150),
    );
  });

  it('rejects content items on a schema 3 project', () => {
    fc.assert(
      fc.property(currentProject({ version: 4 }), (project) => {
        expect(outcome(() => validateProject({ ...project, schemaVersion: 3 })).accepted).toBe(false);
      }),
      runs(50),
    );
  });
});
