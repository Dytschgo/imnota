// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectData, ProjectSnapshot } from '../src/shared/types.js';
import { orderedCollectionItems } from '../src/shared/content-items.js';
import { validateProject } from '../src/shared/schema.js';
import { emptyProject } from '../src/shared/utils.js';
import {
  ContentPersistenceService,
  EMPTY_DRAWING_PNG,
  EMPTY_EXCALIDRAW_SOURCE,
} from './content-persistence.js';
import { contentItemRelativePaths } from './content-paths.js';
import { recoverContentTrashTransactions } from './content-trash.js';
import { BackupService } from './backup-service.js';
import { DEFAULT_BACKUP_PREFERENCES } from '../src/shared/backups.js';
import { atomicWrite } from './files.js';
import { recoverScreenshotTransactions, replayScreenshotTransaction } from './screenshot-transactions.js';

const temporary: string[] = [];
const changedDrawingImage = {
  filename: 'candidate.png',
  width: 1,
  height: 1,
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4AWNQCFjwHwADtAIQHQGQNQAAAABJRU5ErkJggg==',
};
const changedDrawingSource = EMPTY_EXCALIDRAW_SOURCE.replace('#ffffff', '#2050a0');

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

async function fixture(beforeSchemaMigration?: (projectPath: string, project: ProjectData) => Promise<void>) {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-content-')));
  temporary.push(projectPath);
  const project = emptyProject('Mixed content', '');
  project.updatedAt = '2026-09-07T00:00:00.000Z';
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
  let identifier = 0;
  const snapshot = async (target: string): Promise<ProjectSnapshot> => ({
    projectPath: target,
    project: validateProject(JSON.parse(await fs.readFile(path.join(target, 'project.json'), 'utf8'))),
    thumbnails: {},
    recoveryFound: false,
  });
  const service = new ContentPersistenceService({
    snapshot,
    beforeSchemaMigration,
    trashItem: (target) => fs.unlink(target),
    randomId: () => `00000000-0000-4000-8000-${String(++identifier).padStart(12, '0')}`,
    now: () => new Date('2026-09-07T00:00:00.000Z'),
    validatePng: (png, dimensions) => {
      expect(Buffer.from(png).subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(dimensions.width * dimensions.height).toBeGreaterThan(0);
    },
  });
  return { projectPath, project, service, snapshot };
}

describe('native mixed content persistence', () => {
  it('preserves unexpected journal files and rejects a restored receipt without commit images', async () => {
    const { projectPath, service, snapshot } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const deleted = await service.delete({ projectPath, itemId: created.project.contentItems![0].id });
    const retrying = new ContentPersistenceService({
      snapshot,
      trashItem: (target) => fs.unlink(target),
      trashOperations: {
        write: atomicWrite,
        removeDirectory: async () => {
          throw new Error('cleanup blocked');
        },
      },
    });
    await retrying.undoDelete({ projectPath, undoToken: deleted.undoToken });
    const journal = path.join(projectPath, '.imnota-content-undo', deleted.undoToken);
    const extra = path.join(journal, 'unrelated.txt');
    await fs.writeFile(extra, 'Preserve this file');
    expect(await recoverContentTrashTransactions(projectPath)).toMatchObject([
      { status: 'undo-committed', warning: expect.stringContaining('unknown path') },
    ]);
    expect(await fs.readFile(extra, 'utf8')).toBe('Preserve this file');
    const manifestPath = path.join(journal, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    delete manifest.undoAfter;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    await expect(recoverContentTrashTransactions(projectPath)).rejects.toThrow(/commit receipt/);
    expect(await fs.readFile(extra, 'utf8')).toBe('Preserve this file');
  });
  it('preserves external edits after Undo committed but its completion marker could not be written', async () => {
    const { projectPath, service, snapshot } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const item = created.project.contentItems![0];
    const deleted = await service.delete({ projectPath, itemId: item.id });
    const retrying = new ContentPersistenceService({
      snapshot,
      trashItem: (target) => fs.unlink(target),
      trashOperations: {
        write: async (target, bytes) => {
          if (
            path.basename(target) === 'manifest.json' &&
            JSON.parse(Buffer.from(bytes).toString()).phase === 'restored'
          )
            throw new Error('completion marker blocked');
          await atomicWrite(target, bytes);
        },
        removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
      },
    });
    await retrying.undoDelete({ projectPath, undoToken: deleted.undoToken });
    const target = path.join(projectPath, contentItemRelativePaths(item).markdown!);
    await fs.writeFile(target, 'External edit after Undo');
    const metadata = await fs.readFile(path.join(projectPath, 'project.json'));
    expect(await recoverContentTrashTransactions(projectPath)).toMatchObject([
      { status: 'undo-committed', undoAvailable: false },
    ]);
    expect(await fs.readFile(target, 'utf8')).toBe('External edit after Undo');
    expect(await fs.readFile(path.join(projectPath, 'project.json'))).toEqual(metadata);
  });

  it('does not clean a completed receipt transplanted into a different project', async () => {
    const { projectPath, service, snapshot } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const deleted = await service.delete({ projectPath, itemId: created.project.contentItems![0].id });
    const retrying = new ContentPersistenceService({
      snapshot,
      trashItem: (target) => fs.unlink(target),
      trashOperations: {
        write: atomicWrite,
        removeDirectory: async () => {
          throw new Error('cleanup blocked');
        },
      },
    });
    await retrying.undoDelete({ projectPath, undoToken: deleted.undoToken });
    const metadataPath = path.join(projectPath, 'project.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    metadata.id = 'different-project';
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    await expect(recoverContentTrashTransactions(projectPath)).rejects.toThrow(/another project/);
    await expect(retrying.undoDelete({ projectPath, undoToken: deleted.undoToken })).rejects.toThrow(
      /different project/,
    );
    expect(await fs.readdir(path.join(projectPath, '.imnota-content-undo'))).toContain(deleted.undoToken);
  });
  it.each(['text', 'drawing'] as const)(
    'recovers completed %s Undo without overwriting later edits when cleanup was blocked',
    async (kind) => {
      const { projectPath, service, snapshot } = await fixture();
      const created = await service.create({ projectPath, collectionId: '001-collection', kind });
      const item = created.project.contentItems![0];
      const deleted = await service.delete({ projectPath, itemId: item.id });
      const blocked = {
        write: atomicWrite,
        removeDirectory: async () => {
          throw new Error('cleanup blocked');
        },
      };
      const retrying = new ContentPersistenceService({
        snapshot,
        trashItem: (target) => fs.unlink(target),
        trashOperations: blocked,
      });
      await retrying.undoDelete({ projectPath, undoToken: deleted.undoToken });
      const loaded = await service.load({ projectPath, itemId: item.id });
      await service.save({
        projectPath,
        itemId: item.id,
        contentRevision: loaded.contentRevision,
        ...(kind === 'text'
          ? { markdown: 'Later text must survive' }
          : {
              source: changedDrawingSource,
              image: { ...changedDrawingImage, filename: loaded.image!.filename },
            }),
      });
      const files = ['project.json', ...Object.values(contentItemRelativePaths(item))];
      const read = () => Promise.all(files.map((file) => fs.readFile(path.join(projectPath, file))));
      const before = await read();
      expect(await recoverContentTrashTransactions(projectPath, blocked)).toMatchObject([
        { status: 'undo-committed', undoAvailable: false, warning: expect.stringContaining('cleanup') },
      ]);
      expect(await read()).toEqual(before);
      await expect(retrying.undoDelete({ projectPath, undoToken: deleted.undoToken })).resolves.toMatchObject(
        { project: (await snapshot(projectPath)).project },
      );
      expect(await read()).toEqual(before);
      expect(await recoverContentTrashTransactions(projectPath)).toMatchObject([
        { status: 'undo-committed', undoAvailable: false },
      ]);
      expect(await read()).toEqual(before);
      expect(await recoverContentTrashTransactions(projectPath)).toEqual([]);
    },
  );

  it.each([
    { kind: 'text' as const, boundary: 'markdown', rollbackFailure: false },
    { kind: 'text' as const, boundary: 'project.json', rollbackFailure: false },
    { kind: 'drawing' as const, boundary: 'source', rollbackFailure: false },
    { kind: 'drawing' as const, boundary: 'image', rollbackFailure: false },
    { kind: 'drawing' as const, boundary: 'project.json', rollbackFailure: false },
    { kind: 'text' as const, boundary: 'project.json', rollbackFailure: true },
    { kind: 'drawing' as const, boundary: 'project.json', rollbackFailure: true },
  ])(
    'recovers $kind after failure at $boundary (rollback failure: $rollbackFailure)',
    async ({ kind, boundary, rollbackFailure }) => {
      const { projectPath, service, snapshot } = await fixture();
      const created = await service.create({ projectPath, collectionId: '001-collection', kind });
      const item = created.project.contentItems![0];
      const unrelated = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
      const paths = contentItemRelativePaths(item);
      const failPath = path.join(
        projectPath,
        boundary === 'project.json' ? boundary : paths[boundary as keyof typeof paths]!,
      );
      const allFiles = [
        'project.json',
        ...unrelated.project.contentItems!.flatMap((entry) => Object.values(contentItemRelativePaths(entry))),
      ];
      const read = () => Promise.all(allFiles.map((file) => fs.readFile(path.join(projectPath, file))));
      const baseline = await read();
      let failed = false;
      let rollbackBlocked = false;
      const rollbackTarget = path.join(projectPath, paths.markdown ?? paths.source!);
      const rollbackBytes = await fs.readFile(rollbackTarget);
      const failing = new ContentPersistenceService({
        snapshot,
        trashItem: (target) => fs.unlink(target),
        transactionOperations: {
          write: async (target, bytes) => {
            if (
              failed &&
              rollbackFailure &&
              !rollbackBlocked &&
              target === rollbackTarget &&
              Buffer.from(bytes).equals(rollbackBytes)
            ) {
              rollbackBlocked = true;
              throw new Error('injected rollback failure');
            }
            if (target === failPath && !failed) {
              failed = true;
              throw new Error('injected save failure');
            }
            await atomicWrite(target, bytes);
          },
          unlink: (target) => fs.unlink(target),
          removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
        },
      });
      const loaded = await service.load({ projectPath, itemId: item.id });
      await expect(
        failing.save({
          projectPath,
          itemId: item.id,
          contentRevision: loaded.contentRevision,
          ...(kind === 'text'
            ? { markdown: 'Recovered candidate' }
            : {
                source: changedDrawingSource,
                image: { ...changedDrawingImage, filename: loaded.image!.filename },
              }),
        }),
      ).rejects.toThrow();
      expect(failed).toBe(true);
      if (!rollbackFailure) expect(await read()).toEqual(baseline);
      expect(rollbackBlocked).toBe(rollbackFailure);
      const recovery = await recoverScreenshotTransactions(projectPath);
      expect(await read()).toEqual(baseline);
      expect(recovery).toHaveLength(1);
      expect(recovery[0].candidateAvailable).toBe(true);
      await replayScreenshotTransaction(projectPath, recovery[0].token);
      const reopened = new ContentPersistenceService({ snapshot, trashItem: (target) => fs.unlink(target) });
      const recovered = await reopened.load({ projectPath, itemId: item.id });
      expect(kind === 'text' ? recovered.markdown : recovered.source).toBe(
        kind === 'text' ? 'Recovered candidate' : changedDrawingSource,
      );
      if (kind === 'drawing') expect(recovered.image?.dataUrl).toBe(changedDrawingImage.dataUrl);
      const after = await read();
      for (let i = 1; i < allFiles.length; i++)
        if (!Object.values(paths).includes(allFiles[i])) expect(after[i]).toEqual(baseline[i]);
    },
  );
  it('rejects deletion of an unknown item without changing project metadata or content', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const before = await fs.readFile(path.join(projectPath, 'project.json'));
    const item = created.project.contentItems![0];
    const files = Object.values(contentItemRelativePaths(item)).map((relative) =>
      path.join(projectPath, relative),
    );
    const bytes = await Promise.all(files.map((file) => fs.readFile(file)));
    await expect(service.delete({ projectPath, itemId: 'does-not-belong' })).rejects.toThrow(/not found/i);
    expect(await fs.readFile(path.join(projectPath, 'project.json'))).toEqual(before);
    expect(await Promise.all(files.map((file) => fs.readFile(file)))).toEqual(bytes);
  });
  it.each(['text', 'drawing'] as const)(
    'publishes a real schema 3 snapshot before the first %s upgrades the project to schema 4',
    async (kind) => {
      const observations: Array<{ schemaVersion: number; contentExists: boolean }> = [];
      const backupHolder: { current: BackupService | null } = { current: null };
      let createdSnapshot = '';
      const { projectPath, service } = await fixture(async (target, project) => {
        observations.push({
          schemaVersion: project.schemaVersion,
          contentExists: Boolean(
            await fs.stat(path.join(target, 'project.v3.backup.json')).catch(() => null),
          ),
        });
        createdSnapshot = (await backupHolder.current!.createSnapshot(target, 'migration')).snapshotId;
      });
      const backupParent = `${projectPath}-backups`;
      temporary.push(backupParent);
      backupHolder.current = new BackupService({
        getLocation: () => backupParent,
        getWorkspace: () => path.dirname(projectPath),
        getPreferences: () => ({ ...DEFAULT_BACKUP_PREFERENCES, enabled: true }),
        now: () => new Date('2026-09-13T12:00:00.000Z'),
        randomId: () => '00000000-0000-4000-8000-000000000099',
      });
      const beforeProject = await fs.readFile(path.join(projectPath, 'project.json'));
      const created = await service.create({ projectPath, collectionId: '001-collection', kind });
      expect(observations).toEqual([{ schemaVersion: 3, contentExists: false }]);
      expect(created.project.schemaVersion).toBe(4);
      expect((await backupHolder.current.inspectSnapshot(createdSnapshot)).summary).toMatchObject({
        schemaVersion: 3,
        reason: 'migration',
      });
      const snapshotProject = path.join(
        backupParent,
        '.imnota-backups',
        'snapshots',
        createHash('sha256').update(created.project.id).digest('hex').slice(0, 32),
        createdSnapshot,
        'data',
        'project.json',
      );
      expect(await fs.readFile(snapshotProject)).toEqual(beforeProject);
    },
  );

  it('does not reuse an older migration backup even when it belongs to the same project', async () => {
    const { projectPath, service } = await fixture();
    const target = path.join(projectPath, 'project.json');
    const baseline = await fs.readFile(target);
    const older = JSON.parse(baseline.toString('utf8'));
    older.name = 'Old project name';
    const backup = Buffer.from(JSON.stringify(older, null, 2));
    await fs.writeFile(path.join(projectPath, 'project.v3.backup.json'), backup);
    await expect(
      service.create({ projectPath, collectionId: '001-collection', kind: 'text' }),
    ).rejects.toThrow(/backup differs/);
    expect(await fs.readFile(target)).toEqual(baseline);
    expect(await fs.readFile(path.join(projectPath, 'project.v3.backup.json'))).toEqual(backup);
  });
  it('upgrades on first create, writes a byte-exact v3 backup, and inserts after a screenshot', async () => {
    const { projectPath, project, service } = await fixture();
    project.screenshots = [
      {
        collectionId: '001-collection',
        id: 'shot_a',
        originalFilename: 'screen.png',
        storedFilename: 'screen.png',
        title: 'Screen',
        description: '',
        position: 0,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        priority: 'medium',
        annotationFile: 'collections/001-collection/annotations/screen.png.json',
        descriptionFile: 'collections/001-collection/descriptions/screen.png.md',
        originalWidth: 1,
        originalHeight: 1,
        includeInExport: true,
      },
    ];
    const version3Source = JSON.stringify(project, null, 2);
    await fs.writeFile(path.join(projectPath, 'project.json'), version3Source);
    const created = await service.create({
      projectPath,
      collectionId: '001-collection',
      kind: 'text',
      afterItemId: 'shot_a',
    });
    expect(created.project.schemaVersion).toBe(4);
    expect(orderedCollectionItems(created.project, '001-collection').map((item) => item.kind)).toEqual([
      'screenshot',
      'text',
    ]);
    expect(await fs.readFile(path.join(projectPath, 'project.v3.backup.json'), 'utf8')).toBe(version3Source);
    const item = created.project.contentItems![0];
    expect(await fs.readFile(path.join(projectPath, contentItemRelativePaths(item).markdown!), 'utf8')).toBe(
      '',
    );
  });

  it('creates a genuine empty scene and a structurally valid 160x120 white PNG', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({
      projectPath,
      collectionId: '001-collection',
      kind: 'drawing',
    });
    const item = created.project.contentItems![0];
    expect(item).toMatchObject({ kind: 'drawing', originalWidth: 160, originalHeight: 120 });
    const paths = contentItemRelativePaths(item);
    expect(await fs.readFile(path.join(projectPath, paths.source!), 'utf8')).toBe(EMPTY_EXCALIDRAW_SOURCE);
    expect(await fs.readFile(path.join(projectPath, paths.image!))).toEqual(EMPTY_DRAWING_PNG);
    const idatLength = EMPTY_DRAWING_PNG.readUInt32BE(33);
    const pixels = inflateSync(EMPTY_DRAWING_PNG.subarray(41, 41 + idatLength));
    expect([...pixels.subarray(0, 5)]).toEqual([0, 255, 255, 255, 255]);
    const loaded = await service.load({ projectPath, itemId: item.id });
    expect(loaded).toMatchObject({ source: EMPTY_EXCALIDRAW_SOURCE, image: { width: 160, height: 120 } });
  });

  it('round-trips text and preserves a stale autosave as a hidden conflict copy', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const itemId = created.project.contentItems![0].id;
    const empty = await service.load({ projectPath, itemId });
    const saved = await service.save({
      projectPath,
      itemId,
      contentRevision: empty.contentRevision,
      markdown: '# Current\n\nSaved body',
    });
    expect(saved.conflictCreated).toBe(false);
    expect((await service.load({ projectPath, itemId })).markdown).toBe('# Current\n\nSaved body');
    const conflict = await service.save({
      projectPath,
      itemId,
      contentRevision: empty.contentRevision,
      markdown: '# Stale but preserved',
    });
    expect(conflict.conflictCreated).toBe(true);
    expect(conflict.itemId).not.toBe(itemId);
    expect(conflict.snapshot.project.contentItems).toHaveLength(2);
    expect(conflict.snapshot.project.contentItems!.find((item) => item.id === conflict.itemId)).toMatchObject(
      {
        includeInExport: false,
        preview: '# Stale but preserved',
      },
    );
    expect((await service.load({ projectPath, itemId: conflict.itemId })).markdown).toBe(
      '# Stale but preserved',
    );
  });

  it('saves drawing JSON and PNG together and rejects malformed source before mutation', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'drawing' });
    const item = created.project.contentItems![0];
    const loaded = await service.load({ projectPath, itemId: item.id });
    const source = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'https://excalidraw.com',
      elements: [{ id: 'box', type: 'rectangle', x: 10, y: 12, width: 80, height: 40, version: 1 }],
      appState: { viewBackgroundColor: '#fff' },
      files: {},
    });
    const saved = await service.save({
      projectPath,
      itemId: item.id,
      contentRevision: loaded.contentRevision,
      source,
      image: loaded.image!,
    });
    expect(saved.conflictCreated).toBe(false);
    expect((await service.load({ projectPath, itemId: item.id })).source).toBe(source);
    await expect(
      service.save({
        projectPath,
        itemId: item.id,
        contentRevision: saved.contentRevision,
        source: JSON.stringify({
          type: 'excalidraw',
          version: 2,
          elements: [{ id: 'bad', type: 'rectangle', x: Number.NaN, y: 0, width: 1, height: 1 }],
          appState: {},
          files: {},
        }),
        image: loaded.image!,
      }),
    ).rejects.toThrow(/invalid Excalidraw element/);
    expect((await service.load({ projectPath, itemId: item.id })).source).toBe(source);

    const damaged = Buffer.from(EMPTY_DRAWING_PNG);
    damaged[damaged.length - 8] ^= 1;
    await expect(
      service.save({
        projectPath,
        itemId: item.id,
        contentRevision: saved.contentRevision,
        source,
        image: {
          ...loaded.image!,
          dataUrl: `data:image/png;base64,${damaged.toString('base64')}`,
        },
      }),
    ).rejects.toThrow(/CRC validation/);
  });

  it('duplicates byte-exact content and deletes/undoes it through a recoverable grant', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({ projectPath, collectionId: '001-collection', kind: 'text' });
    const itemId = created.project.contentItems![0].id;
    const loaded = await service.load({ projectPath, itemId });
    await service.save({
      projectPath,
      itemId,
      contentRevision: loaded.contentRevision,
      markdown: 'Durable body',
    });
    const duplicated = await service.duplicate({ projectPath, itemId });
    const duplicate = duplicated.project.contentItems!.find((item) => item.id !== itemId)!;
    expect((await service.load({ projectPath, itemId: duplicate.id })).markdown).toBe('Durable body');
    const deleted = await service.delete({ projectPath, itemId: duplicate.id });
    expect(deleted.snapshot.project.contentItems).toHaveLength(1);
    const grants = await recoverContentTrashTransactions(projectPath);
    expect(grants).toEqual([
      expect.objectContaining({ itemId: duplicate.id, undoAvailable: true, status: 'deletion-committed' }),
    ]);
    const restored = await service.undoDelete({ projectPath, undoToken: deleted.undoToken });
    expect(restored.project.contentItems).toHaveLength(2);
    expect((await service.load({ projectPath, itemId: duplicate.id })).markdown).toBe('Durable body');
  });

  it('restores both drawing files and metadata when system trash fails partway', async () => {
    const { projectPath, service, snapshot } = await fixture();
    const created = await service.create({
      projectPath,
      collectionId: '001-collection',
      kind: 'drawing',
    });
    const item = created.project.contentItems![0];
    const paths = contentItemRelativePaths(item);
    const beforeSource = await fs.readFile(path.join(projectPath, paths.source!));
    const beforeImage = await fs.readFile(path.join(projectPath, paths.image!));
    let calls = 0;
    const failing = new ContentPersistenceService({
      snapshot,
      trashItem: async (target) => {
        calls += 1;
        if (calls === 2) throw new Error('simulated trash failure');
        await fs.unlink(target);
      },
    });
    await expect(failing.delete({ projectPath, itemId: item.id })).rejects.toThrow(
      /baseline files were restored/,
    );
    expect(await fs.readFile(path.join(projectPath, paths.source!))).toEqual(beforeSource);
    expect(await fs.readFile(path.join(projectPath, paths.image!))).toEqual(beforeImage);
    expect((await snapshot(projectPath)).project.contentItems).toHaveLength(1);
  });

  it('preserves an occupied Undo path, then permits retry after the collision is resolved', async () => {
    const { projectPath, service } = await fixture();
    const created = await service.create({
      projectPath,
      collectionId: '001-collection',
      kind: 'text',
    });
    const item = created.project.contentItems![0];
    const deleted = await service.delete({ projectPath, itemId: item.id });
    const target = path.join(projectPath, contentItemRelativePaths(item).markdown!);
    await fs.writeFile(target, 'external occupant');
    await expect(service.undoDelete({ projectPath, undoToken: deleted.undoToken })).rejects.toThrow(
      /occupied|changed/,
    );
    expect(await fs.readFile(target, 'utf8')).toBe('external occupant');
    await fs.unlink(target);
    const restored = await service.undoDelete({
      projectPath,
      undoToken: deleted.undoToken,
    });
    expect(restored.project.contentItems).toHaveLength(1);
    expect(await fs.readFile(target, 'utf8')).toBe('');
  });
});
