// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { parseProjectFile, validateLegacyProject, validateProject } from '../src/shared/schema.js';
import {
  currentProject,
  legacyFixture,
  portableName,
  storedText,
  type LegacyFixture,
} from '../src/test/project-arbitraries.js';
import { runs } from '../src/test/property.js';
import { migrateProject, screenshotPath } from './collections.js';
import { preserveMixedProjectMetadata } from './content-project-metadata.js';
import { atomicWrite } from './files.js';

async function isolated<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-property-')));
  try {
    return await run(directory);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

const persistedProject = currentProject({ names: portableName, text: storedText, maxItems: 6 });
const read = async (directory: string) =>
  parseProjectFile(JSON.parse(await fs.readFile(path.join(directory, 'project.json'), 'utf8')));

async function writeLegacy(directory: string, fixture: LegacyFixture) {
  const project = validateLegacyProject(fixture.project);
  const originals = new Map<string, Buffer>();
  const metadata = Buffer.from(JSON.stringify(fixture.project));
  originals.set(path.join(directory, 'project.json'), metadata);
  for (const shot of project.screenshots) {
    const image =
      project.schemaVersion === 1
        ? path.join(directory, 'screenshots', shot.storedFilename)
        : path.join(directory, 'rounds', shot.roundId, 'screenshots', shot.storedFilename);
    originals.set(image, Buffer.from(fixture.images[shot.id]));
    for (const [relative, contents] of [
      [shot.notesFile, fixture.notes[shot.id]],
      [shot.annotationFile, fixture.annotations[shot.id]],
    ] as const) {
      if (contents !== null)
        originals.set(
          path.join(directory, ...relative.replaceAll('\\', '/').split('/')),
          Buffer.from(contents),
        );
    }
  }
  for (const [target, bytes] of originals) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  }
  return { project, originals, metadata };
}

describe('persisted project properties', () => {
  it('preserves generated mixed content and IDs through metadata save and disk reopen', async () => {
    await fc.assert(
      fc.asyncProperty(persistedProject, storedText, async (project, description) => {
        await isolated(async (directory) => {
          await atomicWrite(path.join(directory, 'project.json'), JSON.stringify(project));
          const current = validateProject(await read(directory));
          const candidate = {
            ...current,
            description,
            screenshots: current.screenshots.map((shot) => ({
              ...shot,
              includeInExport: !shot.includeInExport,
            })),
          };
          const saved = preserveMixedProjectMetadata(current, candidate);
          await atomicWrite(path.join(directory, 'project.json'), JSON.stringify(saved));
          const reopened = validateProject(await read(directory));
          expect(reopened).toEqual(JSON.parse(JSON.stringify(saved)));
          expect(reopened.description).toBe(description);
          expect(reopened.screenshots.map((shot) => shot.id)).toEqual(
            project.screenshots.map((shot) => shot.id),
          );
          expect(reopened.contentItems).toEqual(project.contentItems);
          expect(await fs.readdir(directory)).toEqual(['project.json']);
        });
      }),
      runs(20),
    );
  });

  it('preserves committed bytes after replacement failure, cleans staging, and permits the next write', async () => {
    await fc.assert(
      fc.asyncProperty(persistedProject, storedText, async (project, description) => {
        await isolated(async (directory) => {
          const target = path.join(directory, 'project.json');
          const baseline = JSON.stringify(project);
          await atomicWrite(target, baseline);
          const candidate = JSON.stringify({ ...project, description });
          const replace = vi
            .spyOn(fs, 'rename')
            .mockRejectedValueOnce(Object.assign(new Error('No space'), { code: 'ENOSPC' }));
          try {
            await expect(atomicWrite(target, candidate)).rejects.toMatchObject({ code: 'ENOSPC' });
            expect(await fs.readFile(target, 'utf8')).toBe(baseline);
            expect(await fs.readdir(directory)).toEqual(['project.json']);
            await atomicWrite(target, candidate);
            expect(validateProject(await read(directory)).description).toBe(description);
            expect(await fs.readdir(directory)).toEqual(['project.json']);
          } finally {
            replace.mockRestore();
          }
        });
      }),
      runs(15),
    );
  });

  it('migrates generated legacy projects without changing original images, sidecars or backup metadata', async () => {
    await fc.assert(
      fc.asyncProperty(legacyFixture(), async (fixture) => {
        await isolated(async (directory) => {
          const { project, originals, metadata } = await writeLegacy(directory, fixture);
          const migrated = await migrateProject(directory, project);
          expect(await read(directory)).toEqual(JSON.parse(JSON.stringify(migrated)));
          expect(migrated.screenshots.map((shot) => shot.id)).toEqual(
            project.screenshots.map((shot) => shot.id),
          );
          expect(migrated.collections.map((collection) => collection.id)).toEqual(
            project.rounds.map((round) => round.id),
          );
          expect(
            await fs.readFile(path.join(directory, `project.v${project.schemaVersion}.backup.json`)),
          ).toEqual(metadata);
          for (const [target, bytes] of originals) {
            if (path.basename(target) !== 'project.json') expect(await fs.readFile(target)).toEqual(bytes);
          }
          for (const shot of migrated.screenshots) {
            expect(await fs.readFile(screenshotPath(directory, shot))).toEqual(
              Buffer.from(fixture.images[shot.id]),
            );
            expect(await fs.readFile(path.join(directory, shot.annotationFile), 'utf8')).toBe(
              fixture.annotations[shot.id] ?? '[]',
            );
            expect(await fs.readFile(path.join(directory, shot.descriptionFile), 'utf8')).toBe(
              shot.description,
            );
            const original = project.screenshots.find((entry) => entry.id === shot.id)!;
            if (original.description.trim()) expect(shot.description).toContain(original.description);
            const notes = fixture.notes[shot.id];
            if (notes?.trim()) expect(shot.description).toContain(notes);
          }
          const committed = await fs.readFile(path.join(directory, 'project.json'));
          expect(await migrateProject(directory, migrated)).toEqual(migrated);
          expect(await fs.readFile(path.join(directory, 'project.json'))).toEqual(committed);
        });
      }),
      runs(15),
    );
  });

  it('keeps legacy metadata recoverable after a missing-image failure and succeeds after the source is restored', async () => {
    const populated = legacyFixture().filter(
      (fixture) => validateLegacyProject(fixture.project).screenshots.length > 0,
    );
    await fc.assert(
      fc.asyncProperty(populated, fc.nat(), async (fixture, pick) => {
        await isolated(async (directory) => {
          const { project, originals, metadata } = await writeLegacy(directory, fixture);
          const shot = project.screenshots[pick % project.screenshots.length];
          const image =
            project.schemaVersion === 1
              ? path.join(directory, 'screenshots', shot.storedFilename)
              : path.join(directory, 'rounds', shot.roundId, 'screenshots', shot.storedFilename);
          await fs.unlink(image);
          await expect(migrateProject(directory, project)).rejects.toMatchObject({ code: 'ENOENT' });
          expect(await fs.readFile(path.join(directory, 'project.json'))).toEqual(metadata);
          expect(
            await fs.readFile(path.join(directory, `project.v${project.schemaVersion}.backup.json`)),
          ).toEqual(metadata);
          for (const [target, bytes] of originals)
            if (target !== image) expect(await fs.readFile(target)).toEqual(bytes);
          await fs.writeFile(image, originals.get(image)!);
          const recovered = await migrateProject(directory, project);
          expect(await read(directory)).toEqual(JSON.parse(JSON.stringify(recovered)));
          expect(recovered.screenshots.map((entry) => entry.id)).toEqual(
            project.screenshots.map((entry) => entry.id),
          );
        });
      }),
      runs(10),
    );
  });
});
