// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectSnapshot } from '../src/shared/types.js';
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

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

async function fixture() {
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
