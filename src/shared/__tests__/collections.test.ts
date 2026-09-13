// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { legacyProjectSchema, parseProjectFile, validateProject } from '../schema';
import { emptyProject } from '../utils';
import {
  addEmptyCollection,
  migrateProject,
  migrateProjectWithBackup,
  screenshotPath,
} from '../../../electron/collections';
import { BackupService } from '../../../electron/backup-service';
import { DEFAULT_BACKUP_PREFERENCES } from '../backups';

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

function backupFixture(dir: string) {
  const backupParent = `${dir}-backups`;
  temporary.push(backupParent);
  let sequence = 0;
  const backups = new BackupService({
    getLocation: () => backupParent,
    getWorkspace: () => path.dirname(dir),
    getPreferences: () => ({ ...DEFAULT_BACKUP_PREFERENCES, enabled: true }),
    now: () => new Date('2026-09-13T12:00:00.000Z'),
    randomId: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
  });
  const snapshotRoot = (projectId: string, snapshotId: string) =>
    path.join(
      backupParent,
      '.imnota-backups',
      'snapshots',
      createHash('sha256').update(projectId).digest('hex').slice(0, 32),
      snapshotId,
    );
  return { backups, snapshotRoot };
}

describe.each([1, 2] as const)('project v%s migration', (version) => {
  it('publishes a byte-exact local-history snapshot before the real legacy migration', async () => {
    const { dir, project, imagePath } = await fixture(version);
    const { backups, snapshotRoot } = backupFixture(dir);
    const beforeProject = await fs.readFile(path.join(dir, 'project.json'));
    const beforeImage = await fs.readFile(imagePath);
    let createdSnapshot = '';
    const migrated = await migrateProjectWithBackup(dir, project, async () => {
      const created = await backups.createSnapshot(dir, 'migration');
      createdSnapshot = created.snapshotId;
    });

    expect(migrated.schemaVersion).toBe(3);
    expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).schemaVersion).toBe(3);
    const inspection = await backups.inspectSnapshot(createdSnapshot);
    expect(inspection.summary).toMatchObject({ schemaVersion: version, reason: 'migration' });
    expect(inspection.manifest).not.toHaveProperty('absentLegacySidecars');
    const data = path.join(snapshotRoot(project.id, createdSnapshot), 'data');
    expect(await fs.readFile(path.join(data, 'project.json'))).toEqual(beforeProject);
    expect(await fs.readFile(path.join(data, path.relative(dir, imagePath)))).toEqual(beforeImage);
  });

  it.each(['notes', 'annotations', 'both'] as const)(
    'backs up and restores missing %s without inventing files, then migrates with backups enabled',
    async (missing) => {
      const { dir, project, notes } = await fixture(version);
      const { backups, snapshotRoot } = backupFixture(dir);
      const shot = project.screenshots[0];
      const absent = [
        ...(missing !== 'notes' ? [shot.annotationFile] : []),
        ...(missing !== 'annotations' ? [shot.notesFile] : []),
      ];
      for (const relative of absent) {
        await fs.unlink(path.join(dir, relative));
        await fs.rmdir(path.dirname(path.join(dir, relative)));
      }
      const beforeProject = await fs.readFile(path.join(dir, 'project.json'));
      const assertAbsent = async (root: string) => {
        for (const relative of absent)
          await expect(fs.lstat(path.join(root, relative))).rejects.toMatchObject({ code: 'ENOENT' });
      };
      let createdSnapshot = '';
      const migrated = await migrateProjectWithBackup(dir, project, async () => {
        createdSnapshot = (await backups.createSnapshot(dir, 'migration')).snapshotId;
        expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(beforeProject);
        await assertAbsent(dir);
      });
      const inspection = await backups.inspectSnapshot(createdSnapshot);
      expect(inspection.manifest.absentLegacySidecars).toEqual(absent);
      expect(inspection.summary).toMatchObject({ schemaVersion: version, fileCount: 4 - absent.length });
      const data = path.join(snapshotRoot(project.id, createdSnapshot), 'data');
      expect(await fs.readFile(path.join(data, 'project.json'))).toEqual(beforeProject);
      await assertAbsent(data);
      await assertAbsent(dir);
      const description =
        missing === 'annotations'
          ? `Existing description\n\n### Migrated legacy notes\n\n${notes}`
          : 'Existing description';
      expect(migrated.screenshots[0].description).toBe(description);

      const restored = await backups.restoreNew(createdSnapshot);
      temporary.push(restored.projectPath);
      await assertAbsent(restored.projectPath);
      for (const file of inspection.manifest.files.filter((entry) => entry.path !== 'project.json'))
        expect(await fs.readFile(path.join(restored.projectPath, file.path))).toEqual(
          await fs.readFile(path.join(data, file.path)),
        );
      const restoredProject = parseProjectFile(
        JSON.parse(await fs.readFile(path.join(restored.projectPath, 'project.json'), 'utf8')),
      );
      expect(restoredProject.schemaVersion).toBe(version);
      let restoredSnapshot = '';
      const reopened = await migrateProjectWithBackup(restored.projectPath, restoredProject, async () => {
        restoredSnapshot = (await backups.createSnapshot(restored.projectPath, 'migration')).snapshotId;
      });
      expect((await backups.inspectSnapshot(restoredSnapshot)).manifest.absentLegacySidecars).toEqual(absent);
      expect(reopened.schemaVersion).toBe(3);
      expect(reopened.screenshots[0].description).toBe(description);
      expect(
        await fs.readFile(path.join(restored.projectPath, reopened.screenshots[0].annotationFile), 'utf8'),
      ).toBe('[]');
      await assertAbsent(restored.projectPath);

      if (missing === 'both') {
        // Force the committed-restore recovery path to validate a legacy tree with explicit absences.
        const unlink = fs.unlink.bind(fs);
        let failed = false;
        const injected = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
          if (!failed && String(target) === path.join(dir, '.imnota-restore-owner.json')) {
            failed = true;
            throw new Error('injected restore marker cleanup failure');
          }
          await unlink(target);
        });
        try {
          const inPlace = await backups.restoreInPlace(createdSnapshot, dir);
          temporary.push(inPlace.rollbackPath);
          expect(failed).toBe(true);
          expect(inPlace.warnings?.join(' ')).not.toContain('Recovery files were preserved');
          await assertAbsent(dir);
          expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(beforeProject);
          await expect(fs.lstat(path.join(dir, '.imnota-restore-owner.json'))).rejects.toMatchObject({
            code: 'ENOENT',
          });
        } finally {
          injected.mockRestore();
        }
      }
    },
    15_000,
  );

  it('still rejects a missing required image before starting migration', async () => {
    const { dir, project, imagePath } = await fixture(version);
    const { backups } = backupFixture(dir);
    const before = await fs.readFile(path.join(dir, 'project.json'));
    await fs.unlink(imagePath);
    await expect(
      migrateProjectWithBackup(dir, project, async () => {
        await backups.createSnapshot(dir, 'migration');
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(before);
    await expect(fs.stat(path.join(dir, `project.v${version}.backup.json`))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await backups.listSnapshots()).snapshots).toEqual([]);
  });

  it.each(['notesFile', 'annotationFile'] as const)(
    'does not treat permissions, non-files, or failed copies of %s as absence',
    async (field) => {
      const { dir, project } = await fixture(version);
      const { backups } = backupFixture(dir);
      const target = path.join(dir, project.screenshots[0][field]);
      const before = await fs.readFile(path.join(dir, 'project.json'));
      const copy = fs.copyFile.bind(fs);
      for (const code of ['EACCES', 'ENOENT']) {
        const injected = vi.spyOn(fs, 'copyFile').mockImplementation(async (source, destination, mode) => {
          if (String(source) === target) throw Object.assign(new Error('injected copy failure'), { code });
          await copy(source, destination, mode);
        });
        try {
          await expect(backups.createSnapshot(dir, 'migration')).rejects.toMatchObject({ code });
        } finally {
          injected.mockRestore();
        }
      }
      const lstat = fs.lstat.bind(fs);
      const denied = vi.spyOn(fs, 'lstat').mockImplementation((candidate, options) => {
        if (String(candidate) === target)
          return Promise.reject(Object.assign(new Error('access denied'), { code: 'EACCES' }));
        return lstat(candidate, options);
      });
      try {
        await expect(backups.createSnapshot(dir, 'migration')).rejects.toMatchObject({ code: 'EACCES' });
      } finally {
        denied.mockRestore();
      }
      await fs.unlink(target);
      await fs.mkdir(target);
      await expect(backups.createSnapshot(dir, 'migration')).rejects.toThrow('regular file');
      expect(await fs.readFile(path.join(dir, 'project.json'))).toEqual(before);
      expect((await backups.listSnapshots()).snapshots).toEqual([]);
    },
  );

  it.each(['notesFile', 'annotationFile'] as const)('rejects linked parents of missing %s', async (field) => {
    const { dir, project } = await fixture(version);
    const { backups } = backupFixture(dir);
    const target = path.join(dir, project.screenshots[0][field]);
    const parent = path.dirname(target);
    const outside = `${dir}-linked-sidecar`;
    temporary.push(outside);
    await fs.mkdir(outside);
    await fs.unlink(target);
    await fs.rmdir(parent);
    await fs.symlink(outside, parent, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(backups.createSnapshot(dir, 'migration')).rejects.toThrow(/Linked|linked/);
    expect((await backups.listSnapshots()).snapshots).toEqual([]);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('rejects a sidecar that appears after its absence was recorded', async () => {
    const { dir, project } = await fixture(version);
    const { backups } = backupFixture(dir);
    const target = path.join(dir, project.screenshots[0].notesFile);
    await fs.unlink(target);
    const rename = fs.rename.bind(fs);
    const injected = vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
      await rename(source, destination);
      if (path.basename(String(destination)) === 'manifest.json') await fs.writeFile(target, 'new notes');
    });
    try {
      await expect(backups.createSnapshot(dir, 'migration')).rejects.toThrow('sidecar appeared');
    } finally {
      injected.mockRestore();
    }
    expect((await backups.listSnapshots()).snapshots).toEqual([]);
    expect(await fs.readFile(target, 'utf8')).toBe('new notes');
  });

  it('rejects unrecorded omissions and forged absence declarations on every snapshot read', async () => {
    const { dir, project, imagePath } = await fixture(version);
    const { backups, snapshotRoot } = backupFixture(dir);
    const absent = project.screenshots[0].notesFile;
    await fs.unlink(path.join(dir, absent));
    const created = await backups.createSnapshot(dir, 'migration');
    const manifest = (await backups.inspectSnapshot(created.snapshotId)).manifest;
    const root = snapshotRoot(project.id, created.snapshotId);
    const imageRelative = path.relative(dir, imagePath).split(path.sep).join('/');
    for (const absentLegacySidecars of [
      undefined,
      ['notes/unreferenced.md'],
      [
        absent.slice(0, absent.lastIndexOf('/') + 1) +
          absent.slice(absent.lastIndexOf('/') + 1).toUpperCase(),
      ],
      [absent, 'notes/unreferenced.md'],
    ]) {
      await fs.writeFile(
        path.join(root, 'manifest.json'),
        JSON.stringify({ ...manifest, absentLegacySidecars }),
      );
      await expect(backups.inspectSnapshot(created.snapshotId)).rejects.toThrow();
      await expect(backups.restoreNew(created.snapshotId)).rejects.toThrow();
      await expect(backups.restoreInPlace(created.snapshotId, dir)).rejects.toThrow();
      await expect(
        backups.exportSnapshot(created.snapshotId, path.join(dir, 'invalid.zip')),
      ).rejects.toThrow();
    }
    // A valid absence never authorizes another unrecorded omission from the full referenced set.
    const annotation = project.screenshots[0].annotationFile;
    const annotationPath = path.join(root, 'data', annotation);
    const annotationBytes = await fs.readFile(annotationPath);
    await fs.unlink(annotationPath);
    await fs.writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        files: manifest.files.filter((file) => file.path !== annotation),
      }),
    );
    await expect(backups.inspectSnapshot(created.snapshotId)).rejects.toThrow(
      'complete authoritative project file set',
    );
    await fs.writeFile(annotationPath, annotationBytes);
    // An image cannot be reclassified as an optional sidecar even when its payload is removed too.
    await fs.unlink(path.join(root, 'data', imageRelative));
    await fs.writeFile(
      path.join(root, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        files: manifest.files.filter((file) => file.path !== imageRelative),
        absentLegacySidecars: [absent, imageRelative],
      }),
    );
    await expect(backups.inspectSnapshot(created.snapshotId)).rejects.toThrow();
    expect((await backups.listSnapshots()).snapshots).toEqual([]);
    expect((await backups.listSnapshots()).invalid).toHaveLength(1);
    await expect(fs.stat(path.join(dir, 'invalid.zip'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

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
  {
    name: 'aliased per-collection screenshot filenames',
    mutate: (project: Awaited<ReturnType<typeof fixture>>['project']) => ({
      ...project,
      screenshots: [...project.screenshots, { ...project.screenshots[0], id: 'second-shot', position: 1 }],
    }),
  },
  {
    name: 'noncanonical v2 sidecar references',
    mutate: (project: Awaited<ReturnType<typeof fixture>>['project']) => ({
      ...project,
      screenshots: [
        {
          ...project.screenshots[0],
          annotationFile: 'rounds/001-first-feedback/annotations/another.png.json',
        },
      ],
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
