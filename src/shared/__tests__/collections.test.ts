// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { legacyProjectSchema, validateProject } from '../schema';
import { emptyProject } from '../utils';
import { addEmptyCollection, migrateProject, screenshotPath } from '../../../electron/collections';

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await fs.rm(folder, { recursive: true, force: true });
});

async function fixture(version: 1 | 2) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-collection-test-')));
  temporary.push(dir);
  const roundId = '001-first-feedback';
  const storedFilename = '001-example.png';
  const annotationFile =
    version === 1 ? 'annotations/example.json' : `rounds/${roundId}/annotations/${storedFilename}.json`;
  const notesFile = version === 1 ? 'notes/example.md' : `rounds/${roundId}/notes/${storedFilename}.md`;
  const project = legacyProjectSchema.parse({
    schemaVersion: version,
    rounds: [{ id: roundId, name: 'First feedback', archived: false, createdAt: '2026-01-01' }],
    id: 'project',
    name: 'Legacy',
    description: 'Project description',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-02',
    status: 'active',
    tags: ['legacy-tag'],
    favourite: false,
    screenshots: [
      {
        roundId,
        id: 'shot',
        originalFilename: 'example.png',
        storedFilename,
        title: 'Example',
        description: 'Existing description',
        position: 0,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-02',
        tags: ['bug'],
        priority: 'critical',
        status: 'ready',
        annotationFile,
        notesFile,
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      includedFields: ['problem'],
      overallInstructions: 'Preserve layout.',
      desiredOutcome: 'Make the defect clear.',
      technicalConstraints: 'Keyboard accessible.',
      template: 'default',
    },
  });
  const imagePath =
    version === 1
      ? path.join(dir, 'screenshots', storedFilename)
      : path.join(dir, 'rounds', roundId, 'screenshots', storedFilename);
  for (const target of [imagePath, path.join(dir, annotationFile), path.join(dir, notesFile)])
    await fs.mkdir(path.dirname(target), { recursive: true });
  const notes = ' \n## problem\n\nKeep this feedback.\n\n## User heading\n\nDo not drop this exact text.\n';
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(project));
  await fs.writeFile(imagePath, Buffer.from([1, 2, 3]));
  await fs.writeFile(path.join(dir, annotationFile), '[]');
  await fs.writeFile(path.join(dir, notesFile), notes);
  return { dir, project, imagePath, notes };
}

describe.each([1, 2] as const)('project v%s migration', (version) => {
  it('copies content, preserves exact legacy Markdown and source files, and is idempotent', async () => {
    const { dir, project, imagePath, notes } = await fixture(version);
    const next = await migrateProject(dir, project);
    expect(validateProject(next).schemaVersion).toBe(3);
    expect(next.screenshots[0].priority).toBe('high');
    expect(next.screenshots[0].description).toContain(notes);
    expect(next.screenshots[0].description.endsWith(notes)).toBe(true);
    expect(next.collections[0].overallContext).toContain('Preserve layout.');
    expect(await fs.readFile(screenshotPath(dir, next.screenshots[0]))).toEqual(Buffer.from([1, 2, 3]));
    expect(await fs.readFile(path.join(dir, next.screenshots[0].descriptionFile), 'utf8')).toContain(notes);
    expect(
      JSON.parse(await fs.readFile(path.join(dir, `project.v${version}.backup.json`), 'utf8')).schemaVersion,
    ).toBe(version);
    expect(await fs.readFile(imagePath)).toEqual(Buffer.from([1, 2, 3]));
    expect(await fs.readFile(path.join(dir, project.screenshots[0].notesFile), 'utf8')).toBe(notes);
    expect(await migrateProject(dir, next)).toEqual(next);
  });
});

it('does not commit metadata on failure and can retry without losing legacy content', async () => {
  const { dir, project, imagePath, notes } = await fixture(2);
  await fs.unlink(imagePath);
  await expect(migrateProject(dir, project)).rejects.toThrow();
  expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).schemaVersion).toBe(2);
  await fs.writeFile(imagePath, Buffer.from([4, 5, 6]));
  const retried = await migrateProject(dir, project);
  expect(retried.screenshots[0].description).toContain(notes);
  expect(validateProject(retried).schemaVersion).toBe(3);
});

it.each([
  {
    name: 'duplicate screenshot IDs',
    mutate: (project: Awaited<ReturnType<typeof fixture>>['project']) => ({
      ...project,
      screenshots: [...project.screenshots, { ...project.screenshots[0] }],
    }),
  },
  {
    name: 'dangling collection references',
    mutate: (project: Awaited<ReturnType<typeof fixture>>['project']) => ({
      ...project,
      screenshots: [{ ...project.screenshots[0], roundId: 'missing-collection' }],
    }),
  },
])('rejects $name before replacing legacy metadata', async ({ mutate }) => {
  const { dir, project } = await fixture(2);
  const malformed = mutate(project);
  await fs.writeFile(path.join(dir, 'project.json'), JSON.stringify(malformed));

  await expect(migrateProject(dir, malformed)).rejects.toThrow();

  expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8'))).toEqual(malformed);
  await expect(fs.stat(path.join(dir, 'project.v2.backup.json'))).rejects.toMatchObject({
    code: 'ENOENT',
  });
});

it('rejects unknown collections, duplicate IDs, and mismatched content paths', () => {
  const project = emptyProject('New', '');
  expect(() =>
    validateProject({ ...project, collections: [{ ...project.collections[0], id: '../escape' }] }),
  ).toThrow();
  expect(() =>
    validateProject({ ...project, collections: [project.collections[0], project.collections[0]] }),
  ).toThrow();
});

it('automatically names an empty collection and archives the previous current collection', () => {
  const project = emptyProject('New', '', 'My Workspace');
  project.screenshots = [];
  const next = addEmptyCollection(project, 'My Workspace', '002-collection', '2026-02-01');
  expect(next.collections).toMatchObject([
    { id: '001-collection', archived: true },
    {
      id: '002-collection',
      name: 'My Workspace / Collection 02',
      archived: false,
      overallContext: '',
    },
  ]);
  expect(next.screenshots).toEqual([]);
});
