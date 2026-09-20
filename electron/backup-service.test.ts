// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BACKUP_PREFERENCES,
  backupManifestSchema,
  type BackupPreferences,
} from '../src/shared/backups.js';
import { parseProjectFile } from '../src/shared/schema.js';
import type { ProjectData } from '../src/shared/types.js';
import { BackupService, backupReservedProjectDirectory } from './backup-service.js';

// Multiple durable publications can exceed five seconds on a busy Windows disk.
const DURABLE_FILESYSTEM_TIMEOUT = 15_000;

let temporaryRoot = '';
let workspace = '';
let backupParent = '';
let preferences: BackupPreferences;
let clock: Date;
let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `${sequence.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
}

function service(overrides: Partial<ConstructorParameters<typeof BackupService>[0]> = {}) {
  return new BackupService({
    getLocation: () => backupParent,
    getWorkspace: () => workspace,
    getPreferences: () => preferences,
    now: () => new Date(clock),
    randomId: nextId,
    ...overrides,
  });
}

function projectKey(projectId: string): string {
  return createHash('sha256').update(projectId).digest('hex').slice(0, 32);
}

function snapshotDirectory(projectId: string, snapshotId: string): string {
  return path.join(backupParent, '.imnota-backups', 'snapshots', projectKey(projectId), snapshotId);
}

async function pendingDeletion() {
  const root = service().location();
  const records = (await fs.readdir(root)).filter((name) =>
    /^\.imnota-backup-delete-[0-9a-f]{32}\.json$/.test(name),
  );
  expect(records).toHaveLength(1);
  const record = path.join(root, records[0]);
  const journal = JSON.parse(await fs.readFile(record, 'utf8')) as {
    token: string;
    phase: string;
    publication: { projectKey: string; snapshotId: string };
  };
  return {
    record,
    journal,
    quarantine: path.join(
      root,
      'snapshots',
      journal.publication.projectKey,
      `.imnota-delete-${journal.token}`,
    ),
  };
}

async function publishedSnapshotIds(): Promise<string[]> {
  const ledger = JSON.parse(
    await fs.readFile(path.join(service().location(), '.imnota-backup-publications-v1.json'), 'utf8'),
  ) as {
    entries: Array<{ snapshotId: string }>;
  };
  return ledger.entries.map((entry) => entry.snapshotId);
}

async function writeProject(name = 'Mixed project'): Promise<{ projectPath: string; project: ProjectData }> {
  const projectPath = path.join(workspace, 'mixed-project');
  const now = '2026-09-01T12:00:00.000Z';
  const project: ProjectData = {
    schemaVersion: 4,
    id: 'project_mixed',
    name,
    description: 'Mixed content fixture',
    createdAt: now,
    updatedAt: now,
    status: 'active',
    favourite: false,
    collections: [
      {
        id: '001-collection',
        name: 'Evidence',
        archived: false,
        createdAt: now,
        updatedAt: now,
        overallContext: 'Keep order',
      },
    ],
    screenshots: [
      {
        id: 'shot_1',
        collectionId: '001-collection',
        originalFilename: 'source.png',
        storedFilename: 'source.png',
        title: 'Source',
        description: 'Screenshot markdown',
        position: 0,
        createdAt: now,
        updatedAt: now,
        priority: 'high',
        annotationFile: 'collections/001-collection/annotations/source.png.json',
        descriptionFile: 'collections/001-collection/descriptions/source.png.md',
        originalWidth: 10,
        originalHeight: 10,
        includeInExport: true,
      },
    ],
    contentItems: [
      {
        id: 'drawing_1',
        kind: 'drawing',
        collectionId: '001-collection',
        position: 1,
        includeInExport: true,
        createdAt: now,
        updatedAt: now,
        title: 'Flow',
        sourceFilename: 'flow.json',
        imageFilename: 'flow.png',
        originalWidth: 20,
        originalHeight: 20,
      },
      {
        id: 'text_1',
        kind: 'text',
        collectionId: '001-collection',
        position: 2,
        includeInExport: true,
        createdAt: now,
        updatedAt: now,
        markdownFilename: 'note.md',
        preview: 'Text preview',
      },
    ],
    exportPreferences: {
      includeOriginalScreenshots: true,
      includeAnnotationMetadata: true,
      template: 'default',
    },
  };
  const files: Record<string, string | Buffer> = {
    'project.json': JSON.stringify(project, null, 2),
    'collections/001-collection/screenshots/source.png': Buffer.from('source-png'),
    'collections/001-collection/annotations/source.png.json': '[{"kind":"arrow"}]',
    'collections/001-collection/descriptions/source.png.md': '# Screenshot markdown',
    'collections/001-collection/drawings/flow.json': '{"type":"excalidraw"}',
    'collections/001-collection/drawings/flow.png': Buffer.from('drawing-png'),
    'collections/001-collection/text/note.md': '# Text block',
    'collections/001-collection/exports/redundant/output.png': Buffer.from('export'),
    '.imnota-recovery.json': '{"cache":true}',
    'unrelated-user-file.txt': 'do not include in snapshots',
  };
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(projectPath, ...relative.split('/'));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, contents);
  }
  return { projectPath, project };
}

beforeEach(async () => {
  temporaryRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-backup-test-')));
  workspace = path.join(temporaryRoot, 'workspace');
  backupParent = path.join(temporaryRoot, 'backup-location');
  await fs.mkdir(workspace, { recursive: true });
  preferences = { ...DEFAULT_BACKUP_PREFERENCES, enabled: true };
  clock = new Date('2026-09-13T12:00:00.000Z');
  sequence = 0;
});

afterEach(async () => {
  if (path.basename(temporaryRoot).startsWith('imnota-backup-test-'))
    await fs.rm(temporaryRoot, { recursive: true, force: true });
});

describe('BackupService', () => {
  it('reserves only owned restore stage and rollback directory names from project discovery', () => {
    expect(backupReservedProjectDirectory(`.imnota-restore-stage-${'a'.repeat(32)}`)).toBe(true);
    expect(backupReservedProjectDirectory(`.imnota-restore-rollback-${'b'.repeat(32)}`)).toBe(true);
    expect(backupReservedProjectDirectory('.imnota-restore-stage-not-owned')).toBe(false);
    expect(backupReservedProjectDirectory('.private-project')).toBe(false);
  });

  it('snapshots, validates, exports, and restores complete mixed content without exports or caches', async () => {
    const fixture = await writeProject();
    const backups = service();
    const created = await backups.createSnapshot(fixture.projectPath, 'manual');
    expect(created.fileCount).toBe(7);

    const inspection = await backups.inspectSnapshot(created.snapshotId);
    expect(inspection.manifest).not.toHaveProperty('absentLegacySidecars');
    expect(inspection.manifest.files.map((file) => file.path)).toEqual([
      'project.json',
      'collections/001-collection/screenshots/source.png',
      'collections/001-collection/annotations/source.png.json',
      'collections/001-collection/descriptions/source.png.md',
      'collections/001-collection/drawings/flow.json',
      'collections/001-collection/drawings/flow.png',
      'collections/001-collection/text/note.md',
    ]);
    expect(inspection.manifest.files.some((file) => file.path.includes('exports'))).toBe(false);
    expect(inspection.manifest.files.some((file) => file.path.includes('recovery'))).toBe(false);

    const archivePath = path.join(temporaryRoot, 'mixed.imnota-backup.zip');
    await backups.exportSnapshot(created.snapshotId, archivePath);
    const archive = await JSZip.loadAsync(await fs.readFile(archivePath));
    expect(Object.keys(archive.files)).toContain('collections/001-collection/text/note.md');
    expect(Object.keys(archive.files).some((name) => name.includes('exports'))).toBe(false);

    const beforeSource = await fs.readFile(path.join(fixture.projectPath, 'project.json'), 'utf8');
    const restored = await backups.restoreNew(created.snapshotId);
    expect(restored.projectPath).not.toBe(fixture.projectPath);
    expect(await fs.readFile(path.join(fixture.projectPath, 'project.json'), 'utf8')).toBe(beforeSource);
    expect(
      await fs.readFile(path.join(restored.projectPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Text block');
    const reopened = parseProjectFile(
      JSON.parse(await fs.readFile(path.join(restored.projectPath, 'project.json'), 'utf8')),
    );
    expect(reopened.id).not.toBe(fixture.project.id);
    expect(reopened.name).toBe('Mixed project restored');
  });

  it.each([
    [3, 'annotations/source.png.json'],
    [3, 'descriptions/source.png.md'],
    [4, 'annotations/source.png.json'],
    [4, 'descriptions/source.png.md'],
    [4, 'drawings/flow.json'],
    [4, 'drawings/flow.png'],
    [4, 'text/note.md'],
  ] as const)('rejects a missing schema %s required file %s', async (version, relative) => {
    const { projectPath, project } = await writeProject();
    if (version === 3) {
      await fs.writeFile(
        path.join(projectPath, 'project.json'),
        JSON.stringify({ ...project, schemaVersion: 3, contentItems: undefined }),
      );
    }
    const before = await fs.readFile(path.join(projectPath, 'project.json'));
    await fs.unlink(path.join(projectPath, 'collections/001-collection', relative));
    await expect(service().createSnapshot(projectPath, 'migration')).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect(await fs.readFile(path.join(projectPath, 'project.json'))).toEqual(before);
    expect((await service().listSnapshots()).snapshots).toEqual([]);
  });

  it('strictly validates absence declarations, including portable aliases and overlaps', async () => {
    const { projectPath } = await writeProject();
    const created = await service().createSnapshot(projectPath, 'manual');
    const manifest = (await service().inspectSnapshot(created.snapshotId)).manifest;
    const legacy = { ...manifest, schemaVersion: 1 };
    for (const absentLegacySidecars of [
      [],
      ['../notes/file.md'],
      ['/notes/file.md'],
      ['notes\\file.md'],
      ['notes/C:file.md'],
      ['notes/file\0.md'],
      ['screenshots/file.png'],
      ['project.json'],
      ['notes/a.md', 'notes/A.md'],
      ['notes/caf\u00e9.md', 'notes/cafe\u0301.md'],
      ['notes/a.md', 'notes/a.md'],
      'notes/a.md',
    ])
      expect(backupManifestSchema.safeParse({ ...legacy, absentLegacySidecars }).success).toBe(false);
    for (const schemaVersion of [3, 4])
      expect(
        backupManifestSchema.safeParse({ ...manifest, schemaVersion, absentLegacySidecars: ['notes/a.md'] })
          .success,
      ).toBe(false);
    expect(
      backupManifestSchema.safeParse({
        ...legacy,
        files: [...manifest.files, { ...manifest.files[0], path: 'notes/a.md' }],
        absentLegacySidecars: ['notes/A.md'],
      }).success,
    ).toBe(false);
    expect(
      backupManifestSchema.safeParse({ ...legacy, absentLegacySidecars: ['notes/a.md'], unknown: true })
        .success,
    ).toBe(false);
  });

  it('reports corruption and traversal manifests without restoring or deleting outside data', async () => {
    const fixture = await writeProject();
    const backups = service();
    const corrupt = await backups.createSnapshot(fixture.projectPath, 'manual');
    await fs.writeFile(
      path.join(snapshotDirectory(fixture.project.id, corrupt.snapshotId), 'data', 'project.json'),
      '{}',
    );
    const corruptList = await backups.listSnapshots();
    expect(corruptList.snapshots).toEqual([]);
    expect(corruptList.invalid[0]?.message).toContain('integrity');
    await expect(backups.restoreNew(corrupt.snapshotId)).rejects.toThrow();

    const clean = await backups.createSnapshot(fixture.projectPath, 'manual');
    const directory = snapshotDirectory(fixture.project.id, clean.snapshotId);
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.files[0].path = '../outside.txt';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const outside = path.join(temporaryRoot, 'outside.txt');
    await fs.writeFile(outside, 'untouched');
    await expect(backups.inspectSnapshot(clean.snapshotId)).rejects.toThrow();
    expect(await fs.readFile(outside, 'utf8')).toBe('untouched');
  });

  it('rejects a manifest and payload that jointly omit a project-referenced content file', async () => {
    const fixture = await writeProject();
    const backups = service();
    const created = await backups.createSnapshot(fixture.projectPath, 'manual');
    const directory = snapshotDirectory(fixture.project.id, created.snapshotId);
    const manifestPath = path.join(directory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    const omitted = 'collections/001-collection/text/note.md';
    manifest.files = manifest.files.filter((file: { path: string }) => file.path !== omitted);
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await fs.unlink(path.join(directory, 'data', ...omitted.split('/')));

    await expect(backups.inspectSnapshot(created.snapshotId)).rejects.toThrow(
      'complete authoritative project file set',
    );
    await expect(backups.restoreInPlace(created.snapshotId, fixture.projectPath)).rejects.toThrow(
      'complete authoritative project file set',
    );
    expect(
      await fs.readFile(path.join(fixture.projectPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Text block');
  });

  it('rejects a linked backup ownership marker without following it', async () => {
    await fs.mkdir(path.join(backupParent, '.imnota-backups'), { recursive: true });
    const outside = path.join(temporaryRoot, 'outside-marker.json');
    await fs.writeFile(outside, JSON.stringify({ version: 1, owner: 'imnota-local-history' }));
    const marker = path.join(backupParent, '.imnota-backups', '.imnota-backups-v1.json');
    try {
      await fs.symlink(outside, marker, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(service().listSnapshots()).rejects.toThrow(/Linked|linked/);
  });

  it('rejects linked snapshot content without following it', async () => {
    const fixture = await writeProject();
    const backups = service();
    const created = await backups.createSnapshot(fixture.projectPath, 'manual');
    const target = path.join(
      snapshotDirectory(fixture.project.id, created.snapshotId),
      'data',
      'project.json',
    );
    const outside = path.join(temporaryRoot, 'outside-project.json');
    await fs.writeFile(outside, await fs.readFile(target));
    await fs.unlink(target);
    try {
      await fs.symlink(outside, target, 'file');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM') return;
      throw error;
    }
    await expect(backups.inspectSnapshot(created.snapshotId)).rejects.toThrow(/Linked|linked/);
    expect((await backups.listSnapshots()).invalid).toHaveLength(1);
  });

  it('rejects a backup root beneath another active project on every library access', async () => {
    const fixture = await writeProject();
    const otherProject = path.join(workspace, 'other-project');
    await fs.mkdir(otherProject);
    await fs.writeFile(path.join(otherProject, 'project.json'), '{}');
    backupParent = path.join(otherProject, 'local-history');

    await expect(service().createSnapshot(fixture.projectPath, 'manual')).rejects.toThrow(
      /inside an active project/,
    );
    await expect(service().listSnapshots()).rejects.toThrow(/inside an active project/);
    await expect(fs.stat(path.join(backupParent, '.imnota-backups'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects snapshot data as an active source before retention can remove it', async () => {
    const fixture = await writeProject();
    const backups = service();
    const original = await backups.createSnapshot(fixture.projectPath, 'manual');
    const source = path.join(snapshotDirectory(fixture.project.id, original.snapshotId), 'data');
    const before = await fs.readFile(path.join(source, 'project.json'));
    preferences = { ...preferences, retentionCount: 1 };
    clock = new Date('2026-09-14T12:00:00.000Z');
    await expect(backups.createSnapshot(source, 'manual')).rejects.toThrow(/separate folders/);
    expect(await fs.readFile(path.join(source, 'project.json'))).toEqual(before);
    expect((await backups.listSnapshots()).snapshots).toHaveLength(1);
  });

  it(
    'applies count and age retention while leaving invalid snapshots untouched',
    async () => {
      const fixture = await writeProject();
      preferences = { ...preferences, retentionCount: 2, retentionAgeDays: 3650 };
      const backups = service();
      const first = await backups.createSnapshot(fixture.projectPath, 'manual');
      clock = new Date('2026-09-14T12:00:00.000Z');
      await backups.createSnapshot(fixture.projectPath, 'manual');
      clock = new Date('2026-09-15T12:00:00.000Z');
      await backups.createSnapshot(fixture.projectPath, 'manual');
      expect((await backups.listSnapshots()).snapshots).toHaveLength(2);
      await expect(backups.inspectSnapshot(first.snapshotId)).rejects.toThrow('not found');

      preferences = { ...preferences, retentionCount: 100, retentionAgeDays: 7 };
      const old = (await backups.listSnapshots()).snapshots.at(-1)!;
      clock = new Date('2026-10-15T12:00:00.000Z');
      await backups.createSnapshot(fixture.projectPath, 'manual');
      await expect(backups.inspectSnapshot(old.snapshotId)).rejects.toThrow('not found');
    },
    DURABLE_FILESYSTEM_TIMEOUT,
  );

  it('keeps an unregistered copied snapshot readable but never removes it through retention', async () => {
    const fixture = await writeProject();
    preferences = { ...preferences, retentionCount: 1, retentionAgeDays: 3650 };
    const backups = service();
    const first = await backups.createSnapshot(fixture.projectPath, 'manual');
    const injectedId = 'snapshot-20260913T130000000Z-eeeeeeee000040008000000000000000';
    const injectedDirectory = snapshotDirectory(fixture.project.id, injectedId);
    await fs.cp(snapshotDirectory(fixture.project.id, first.snapshotId), injectedDirectory, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const manifestPath = path.join(injectedDirectory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.snapshotId = injectedId;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    expect((await backups.inspectSnapshot(injectedId)).summary.snapshotId).toBe(injectedId);

    clock = new Date('2026-09-14T12:00:00.000Z');
    const latest = await backups.createSnapshot(fixture.projectPath, 'manual');
    await expect(backups.inspectSnapshot(first.snapshotId)).rejects.toThrow('not found');
    expect((await backups.inspectSnapshot(injectedId)).summary.snapshotId).toBe(injectedId);
    expect((await backups.inspectSnapshot(latest.snapshotId)).summary.snapshotId).toBe(latest.snapshotId);
  });

  it('rejects oversized in-memory archive export before creating the target', async () => {
    const fixture = await writeProject();
    const created = await service().createSnapshot(fixture.projectPath, 'manual');
    const archive = path.join(temporaryRoot, 'too-large.zip');
    await expect(service({ maxExportBytes: 1 }).exportSnapshot(created.snapshotId, archive)).rejects.toThrow(
      /archive export is limited.*copy the validated snapshot directory/i,
    );
    await expect(fs.stat(archive)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not list interrupted stages and returns committed snapshots with retention warnings', async () => {
    const fixture = await writeProject();
    const backups = service();
    const first = await backups.createSnapshot(fixture.projectPath, 'manual');
    const stage = path.join(backupParent, '.imnota-backups', 'staging', `stage-${'f'.repeat(32)}`);
    await fs.mkdir(stage, { recursive: true });
    await fs.writeFile(
      path.join(stage, '.imnota-stage-owner.json'),
      JSON.stringify({ version: 1, token: 'f'.repeat(32) }),
    );
    expect((await backups.listSnapshots()).snapshots.map((item) => item.snapshotId)).toEqual([
      first.snapshotId,
    ]);

    preferences = { ...preferences, retentionCount: 1 };
    const warningService = service({
      removeDirectory: async (target) => {
        if (target.includes(`${path.sep}snapshots${path.sep}`)) throw new Error('injected cleanup failure');
        await fs.rm(target, { recursive: true, force: true });
      },
    });
    clock = new Date('2026-09-14T12:00:00.000Z');
    const committed = await warningService.createSnapshot(fixture.projectPath, 'manual');
    expect(committed.warnings?.join(' ')).toContain('retention cleanup is pending');
    expect((await warningService.listSnapshots()).snapshots).toHaveLength(1);
    const pending = await pendingDeletion();
    expect(pending.journal.publication.snapshotId).toBe(first.snapshotId);
    expect(await fs.stat(path.join(pending.quarantine, 'manifest.json'))).toBeTruthy();
    // The old snapshot is quarantined; a later process can finish removal after the lock clears.
    clock = new Date('2026-09-15T12:00:00.000Z');
    const latest = await service().createSnapshot(fixture.projectPath, 'manual');
    expect((await service().listSnapshots()).snapshots.map((item) => item.snapshotId)).toEqual([
      latest.snapshotId,
    ]);
    await expect(fs.stat(pending.quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(pending.record)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['before deletion', 'after partial deletion'] as const)(
    'recovers retention %s after a service restart',
    async (failurePoint) => {
      const fixture = await writeProject();
      const first = await service().createSnapshot(fixture.projectPath, 'manual');
      preferences = { ...preferences, retentionCount: 1 };
      clock = new Date('2026-09-14T12:00:00.000Z');
      const interrupted = service({
        removeDirectory: async (target) => {
          if (path.basename(target).startsWith('.imnota-delete-')) {
            if (failurePoint === 'after partial deletion') {
              await fs.unlink(path.join(target, 'manifest.json'));
              await fs.unlink(path.join(target, 'data', 'project.json'));
            }
            throw new Error('locked payload file');
          }
          await fs.rm(target, { recursive: true, force: true });
        },
      });
      const committed = await interrupted.createSnapshot(fixture.projectPath, 'manual');
      expect(committed.warnings?.join(' ')).toContain('locked payload file');
      const pending = await pendingDeletion();
      expect(pending.journal.phase).toBe('deleting');
      expect(await publishedSnapshotIds()).toContain(first.snapshotId);
      expect(
        await fs.readFile(
          path.join(pending.quarantine, 'data/collections/001-collection/text/note.md'),
          'utf8',
        ),
      ).toBe('# Text block');
      if (failurePoint === 'after partial deletion')
        await expect(fs.stat(path.join(pending.quarantine, 'manifest.json'))).rejects.toMatchObject({
          code: 'ENOENT',
        });

      clock = new Date('2026-09-15T12:00:00.000Z');
      const latest = await service().createSnapshot(fixture.projectPath, 'manual');
      expect(latest.warnings).toBeUndefined();
      await expect(fs.stat(pending.quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.stat(pending.record)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await publishedSnapshotIds()).toEqual([latest.snapshotId]);
      expect((await service().listSnapshots()).invalid).toEqual([]);
    },
  );

  it.each(['prepared journal', 'quarantine rename', 'deleting journal'] as const)(
    'preserves a complete snapshot when the %s fails',
    async (failurePoint) => {
      const fixture = await writeProject();
      const first = await service().createSnapshot(fixture.projectPath, 'manual');
      preferences = { ...preferences, retentionCount: 1 };
      clock = new Date('2026-09-14T12:00:00.000Z');
      const rename = fs.rename.bind(fs);
      const remove = vi.fn(async (target: string) => {
        await fs.rm(target, { recursive: true, force: true });
      });
      const injected = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (
          failurePoint === 'quarantine rename' &&
          path.basename(String(target)).startsWith('.imnota-delete-')
        )
          throw new Error('quarantine rename failed');
        if (/\.imnota-backup-delete-[0-9a-f]{32}\.json$/.test(String(target))) {
          const phase = (JSON.parse(await fs.readFile(source, 'utf8')) as { phase: string }).phase;
          if (failurePoint === `${phase} journal`) throw new Error('journal publication failed');
        }
        await rename(source, target);
      });
      try {
        const created = await service({ removeDirectory: remove }).createSnapshot(
          fixture.projectPath,
          'manual',
        );
        expect(created.warnings?.join(' ')).toContain('retention cleanup is pending');
        expect(remove).not.toHaveBeenCalled();
      } finally {
        injected.mockRestore();
      }
      const preserved =
        failurePoint === 'deleting journal'
          ? (await pendingDeletion()).quarantine
          : snapshotDirectory(fixture.project.id, first.snapshotId);
      expect(
        await fs.readFile(path.join(preserved, 'data/collections/001-collection/text/note.md'), 'utf8'),
      ).toBe('# Text block');
      expect(await fs.stat(path.join(preserved, 'manifest.json'))).toBeTruthy();
      expect(await publishedSnapshotIds()).toContain(first.snapshotId);
      clock = new Date('2026-09-15T12:00:00.000Z');
      const latest = await service().createSnapshot(fixture.projectPath, 'manual');
      expect(latest.warnings).toBeUndefined();
      expect(await publishedSnapshotIds()).toEqual([latest.snapshotId]);
    },
    DURABLE_FILESYSTEM_TIMEOUT,
  );

  it.each(['ledger update', 'journal cleanup'] as const)(
    'reconciles a completed deletion after %s fails',
    async (failurePoint) => {
      const fixture = await writeProject();
      const first = await service().createSnapshot(fixture.projectPath, 'manual');
      preferences = { ...preferences, retentionCount: 1 };
      clock = new Date('2026-09-14T12:00:00.000Z');
      let removed = false;
      const rename = fs.rename.bind(fs);
      const unlink = fs.unlink.bind(fs);
      const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
        if (
          removed &&
          failurePoint === 'ledger update' &&
          String(target).endsWith('.imnota-backup-publications-v1.json')
        )
          throw new Error('ledger update failed');
        await rename(source, target);
      });
      const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
        if (
          removed &&
          failurePoint === 'journal cleanup' &&
          /\.imnota-backup-delete-[0-9a-f]{32}\.json$/.test(String(target))
        )
          throw new Error('journal cleanup failed');
        await unlink(target);
      });
      try {
        const created = await service({
          removeDirectory: async (target) => {
            await fs.rm(target, { recursive: true, force: true });
            if (path.basename(target).startsWith('.imnota-delete-')) removed = true;
          },
        }).createSnapshot(fixture.projectPath, 'manual');
        expect(created.warnings?.join(' ')).toContain(`${failurePoint} failed`);
      } finally {
        renameSpy.mockRestore();
        unlinkSpy.mockRestore();
      }
      const pending = await pendingDeletion();
      await expect(fs.stat(pending.quarantine)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await publishedSnapshotIds()).includes(first.snapshotId)).toBe(
        failurePoint === 'ledger update',
      );
      clock = new Date('2026-09-15T12:00:00.000Z');
      const latest = await service().createSnapshot(fixture.projectPath, 'manual');
      expect(latest.warnings).toBeUndefined();
      expect(await publishedSnapshotIds()).toEqual([latest.snapshotId]);
      await expect(fs.stat(pending.record)).rejects.toMatchObject({ code: 'ENOENT' });
    },
    DURABLE_FILESYSTEM_TIMEOUT,
  );

  it('leaves invalid snapshots and unjournaled quarantine or unknown folders untouched', async () => {
    const fixture = await writeProject();
    const first = await service().createSnapshot(fixture.projectPath, 'manual');
    const directory = snapshotDirectory(fixture.project.id, first.snapshotId);
    await fs.unlink(path.join(directory, 'manifest.json'));
    const unowned = [
      path.join(path.dirname(directory), 'personal-files'),
      path.join(path.dirname(directory), `.imnota-delete-${'f'.repeat(32)}`),
    ];
    for (const target of unowned) {
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'keep.txt'), 'unowned');
    }
    preferences = { ...preferences, retentionCount: 1, retentionAgeDays: 1 };
    clock = new Date('2026-09-15T12:00:00.000Z');
    await service().createSnapshot(fixture.projectPath, 'manual');
    for (const target of unowned)
      expect(await fs.readFile(path.join(target, 'keep.txt'), 'utf8')).toBe('unowned');
    expect(
      await fs.readFile(path.join(directory, 'data/collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Text block');
    expect(await publishedSnapshotIds()).toContain(first.snapshotId);
  });

  it.each(['file', 'empty directory'] as const)(
    'refuses an unknown %s added to a journaled partial deletion',
    async (kind) => {
      const fixture = await writeProject();
      const first = await service().createSnapshot(fixture.projectPath, 'manual');
      preferences = { ...preferences, retentionCount: 1 };
      clock = new Date('2026-09-14T12:00:00.000Z');
      await service({
        removeDirectory: async (target) => {
          await fs.unlink(path.join(target, 'manifest.json'));
          throw new Error('partial deletion');
        },
      }).createSnapshot(fixture.projectPath, 'manual');
      const pending = await pendingDeletion();
      const added = path.join(pending.quarantine, 'personal');
      if (kind === 'file') await fs.writeFile(added, 'must survive');
      else await fs.mkdir(added);
      clock = new Date('2026-09-15T12:00:00.000Z');
      const latest = await service().createSnapshot(fixture.projectPath, 'manual');
      expect(latest.warnings?.join(' ')).toContain('unowned');
      if (kind === 'file') expect(await fs.readFile(added, 'utf8')).toBe('must survive');
      else expect((await fs.stat(added)).isDirectory()).toBe(true);
      expect(await publishedSnapshotIds()).toContain(first.snapshotId);
    },
  );

  it.each(['invalid journal', 'invalid snapshot', 'missing publication', 'occupied quarantine'] as const)(
    'refuses deletion recovery with an %s',
    async (change) => {
      const fixture = await writeProject();
      const first = await service().createSnapshot(fixture.projectPath, 'manual');
      preferences = { ...preferences, retentionCount: 1 };
      clock = new Date('2026-09-14T12:00:00.000Z');
      await service({
        rename: async (source, target) => {
          if (path.basename(target).startsWith('.imnota-delete-')) throw new Error('rename interrupted');
          await fs.rename(source, target);
        },
      }).createSnapshot(fixture.projectPath, 'manual');
      const pending = await pendingDeletion();
      expect(pending.journal.phase).toBe('prepared');
      const original = snapshotDirectory(fixture.project.id, first.snapshotId);
      if (change === 'invalid journal') await fs.writeFile(pending.record, '{"version":0}');
      if (change === 'invalid snapshot') await fs.unlink(path.join(original, 'manifest.json'));
      if (change === 'missing publication') {
        const ledgerPath = path.join(service().location(), '.imnota-backup-publications-v1.json');
        const ledger = JSON.parse(await fs.readFile(ledgerPath, 'utf8')) as {
          entries: Array<{ snapshotId: string }>;
        };
        ledger.entries = ledger.entries.filter((entry) => entry.snapshotId !== first.snapshotId);
        await fs.writeFile(ledgerPath, JSON.stringify(ledger));
      }
      if (change === 'occupied quarantine') {
        await fs.mkdir(pending.quarantine);
        await fs.writeFile(path.join(pending.quarantine, 'keep.txt'), 'unowned');
      }
      clock = new Date('2026-09-15T12:00:00.000Z');
      const remove = vi.fn(async (target: string) => {
        await fs.rm(target, { recursive: true, force: true });
      });
      const latest = await service({ removeDirectory: remove }).createSnapshot(fixture.projectPath, 'manual');
      expect(latest.warnings?.join(' ')).toContain('retention cleanup is pending');
      expect(remove).not.toHaveBeenCalled();
      expect(
        await fs.readFile(path.join(original, 'data/collections/001-collection/text/note.md'), 'utf8'),
      ).toBe('# Text block');
      expect(await fs.stat(pending.record)).toBeTruthy();
      if (change === 'occupied quarantine')
        expect(await fs.readFile(path.join(pending.quarantine, 'keep.txt'), 'utf8')).toBe('unowned');
    },
    DURABLE_FILESYSTEM_TIMEOUT,
  );

  it('restores in place with a safety snapshot and preserves every original in a rollback folder', async () => {
    const fixture = await writeProject();
    const backups = service();
    const historical = await backups.createSnapshot(fixture.projectPath, 'manual');
    await fs.writeFile(
      path.join(fixture.projectPath, 'collections/001-collection/text/note.md'),
      '# New edit',
    );
    await fs.writeFile(path.join(fixture.projectPath, 'unrelated-user-file.txt'), 'must survive');

    const restored = await backups.restoreInPlace(historical.snapshotId, fixture.projectPath);
    expect(
      await fs.readFile(path.join(fixture.projectPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Text block');
    expect(await fs.readFile(path.join(restored.rollbackPath, 'unrelated-user-file.txt'), 'utf8')).toBe(
      'must survive',
    );
    expect(
      await fs.readFile(path.join(restored.rollbackPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# New edit');
    expect((await backups.inspectSnapshot(restored.safetySnapshotId)).summary.reason).toBe('safety-restore');
  });

  it('rolls back a failed directory swap and recovers an abrupt interruption before normal open', async () => {
    const fixture = await writeProject();
    const initial = service();
    const historical = await initial.createSnapshot(fixture.projectPath, 'manual');
    await fs.writeFile(
      path.join(fixture.projectPath, 'collections/001-collection/text/note.md'),
      '# Current',
    );
    const failing = service({
      rename: async (source, target) => {
        if (source.includes('.imnota-restore-stage-') && target === fixture.projectPath)
          throw new Error('injected interruption');
        await fs.rename(source, target);
      },
    });
    await expect(failing.restoreInPlace(historical.snapshotId, fixture.projectPath)).rejects.toThrow(
      'injected interruption',
    );
    expect(
      await fs.readFile(path.join(fixture.projectPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Current');

    const token = 'e'.repeat(32);
    const stage = path.join(workspace, `.imnota-restore-stage-${token}`);
    const rollback = path.join(workspace, `.imnota-restore-rollback-${token}`);
    const journal = path.join(workspace, `.imnota-restore-journal-${token}.json`);
    await fs.mkdir(stage);
    await fs.writeFile(path.join(stage, '.imnota-restore-owner.json'), JSON.stringify({ version: 1, token }));
    await fs.writeFile(path.join(stage, 'partial.txt'), 'staged');
    await fs.writeFile(
      journal,
      JSON.stringify({
        version: 1,
        token,
        projectDirectory: path.basename(fixture.projectPath),
        snapshotId: historical.snapshotId,
        sourceProjectId: fixture.project.id,
        phase: 'original-moved',
      }),
    );
    await fs.rename(fixture.projectPath, rollback);
    const messages = await initial.recoverInterruptedRestores();
    expect(messages.join(' ')).toContain('rolled back');
    expect(
      await fs.readFile(path.join(fixture.projectPath, 'collections/001-collection/text/note.md'), 'utf8'),
    ).toBe('# Current');
    await expect(fs.stat(stage)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(journal)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('never replaces an existing empty restore-new directory', async () => {
    const fixture = await writeProject('Mixed project');
    const backups = service();
    const created = await backups.createSnapshot(fixture.projectPath, 'manual');
    const occupied = path.join(workspace, 'mixed-project-restored');
    await fs.mkdir(occupied);
    const restored = await backups.restoreNew(created.snapshotId);
    expect(restored.projectPath).toBe(path.join(workspace, 'mixed-project-restored-2'));
    expect(await fs.readdir(occupied)).toEqual([]);
  });

  it('returns committed restore paths when both journal publication and recovery cleanup fail', async () => {
    const fixture = await writeProject();
    const historical = await service().createSnapshot(fixture.projectPath, 'manual');
    const relative = 'collections/001-collection/text/note.md';
    await fs.writeFile(path.join(fixture.projectPath, relative), '# Newer original');
    let installed = false;
    const rename = fs.rename.bind(fs);
    const unlink = fs.unlink.bind(fs);
    const renameSpy = vi.spyOn(fs, 'rename').mockImplementation(async (source, target) => {
      if (installed && String(target).includes('.imnota-restore-journal-'))
        throw new Error('injected journal publication failure');
      await rename(source, target);
    });
    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation(async (target) => {
      if (installed && String(target).endsWith('.imnota-restore-owner.json'))
        throw new Error('injected recovery cleanup failure');
      await unlink(target);
    });
    try {
      const backups = service({
        rename: async (source, target) => {
          await fs.rename(source, target);
          if (source.includes('.imnota-restore-stage-') && target === fixture.projectPath) installed = true;
        },
      });
      const restored = await backups.restoreInPlace(historical.snapshotId, fixture.projectPath);
      expect(restored.projectPath).toBe(fixture.projectPath);
      expect(restored.safetySnapshotId).toBeTruthy();
      expect(restored.warnings?.join(' ')).toContain('Restore completed');
      expect(restored.warnings?.join(' ')).toContain('Recovery files were preserved');
      expect(await fs.readFile(path.join(fixture.projectPath, relative), 'utf8')).toBe('# Text block');
      expect(await fs.readFile(path.join(restored.rollbackPath, relative), 'utf8')).toBe('# Newer original');
    } finally {
      renameSpy.mockRestore();
      unlinkSpy.mockRestore();
    }
    expect((await service().recoverInterruptedRestores()).join(' ')).toContain('completed');
  });
});
