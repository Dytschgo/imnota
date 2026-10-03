// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TextBlockRecord } from '../src/shared/content-items.js';
import { DELETED_ITEM_RETENTION_MS } from '../src/shared/recently-deleted.js';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { emptyProject } from '../src/shared/utils.js';
import {
  deleteContentItemToTrash,
  recoverContentTrashTransactions,
  undoContentItemDelete,
} from './content-trash.js';
import { atomicWrite } from './files.js';
import { listWorkspaceProjects } from './project-list.js';
import { copyProjectForDuplicate } from './project-duplicate.js';
import { applyOpenDeleteRetention, listRecentlyDeleted, pruneExpiredDeletes } from './recently-deleted.js';
import {
  deleteScreenshotToTrash,
  recoverScreenshotTrashTransactions,
  undoScreenshotDelete,
} from './screenshot-trash.js';

const temporary: string[] = [];
const COLLECTION = '001-collection';
const PHASES_IN_FLIGHT = ['prepared', 'trashing', 'undoing', 'restored'] as const;

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(temporary.splice(0).map((entry) => fs.rm(entry, { recursive: true, force: true })));
});

function screenshotRecord(project: ProjectData, name: string, position: number): ScreenshotRecord {
  return {
    collectionId: COLLECTION,
    id: `shot_${name}`,
    originalFilename: `${name}.png`,
    storedFilename: `${name}.png`,
    title: `Screen ${name}`,
    description: '',
    position,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    priority: 'medium',
    annotationFile: `collections/${COLLECTION}/annotations/${name}.png.json`,
    descriptionFile: `collections/${COLLECTION}/descriptions/${name}.png.md`,
    originalWidth: 1,
    originalHeight: 1,
    includeInExport: true,
  };
}

async function fixture(): Promise<{ projectPath: string; project: ProjectData }> {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-recently-deleted-')));
  temporary.push(projectPath);
  const project = emptyProject('Recently deleted', '');
  project.schemaVersion = 4;
  const text: TextBlockRecord = {
    id: 'text_a',
    collectionId: COLLECTION,
    kind: 'text',
    position: 2,
    includeInExport: true,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    markdownFilename: 'text_a.md',
    preview: 'Context note',
  };
  project.screenshots = [screenshotRecord(project, 'a', 0), screenshotRecord(project, 'b', 1)];
  project.contentItems = [text];
  const base = path.join(projectPath, 'collections', COLLECTION);
  for (const folder of ['screenshots', 'annotations', 'descriptions', 'text'])
    await fs.mkdir(path.join(base, folder), { recursive: true });
  for (const shot of project.screenshots) {
    await fs.writeFile(path.join(base, 'screenshots', shot.storedFilename), `png-${shot.id}`);
    await fs.writeFile(path.join(projectPath, shot.annotationFile), '[]');
    await fs.writeFile(path.join(projectPath, shot.descriptionFile), '');
  }
  await fs.writeFile(path.join(base, 'text', 'text_a.md'), '# Context note');
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2));
  return { projectPath, project };
}

async function readProject(projectPath: string): Promise<ProjectData> {
  return JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')) as ProjectData;
}

async function deleteScreenshot(projectPath: string, id: string): Promise<string> {
  const result = await deleteScreenshotToTrash(projectPath, await readProject(projectPath), id, (target) =>
    fs.unlink(target),
  );
  return result.undoToken;
}

async function deleteText(projectPath: string): Promise<string> {
  const result = await deleteContentItemToTrash(
    projectPath,
    await readProject(projectPath),
    'text_a',
    (target) => fs.unlink(target),
  );
  return result.undoToken;
}

function journal(projectPath: string, token: string): string {
  return path.join(
    projectPath,
    token.startsWith('content-') ? '.imnota-content-undo' : '.imnota-undo',
    token,
  );
}

async function patchManifest(
  projectPath: string,
  token: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const file = path.join(journal(projectPath, token), 'manifest.json');
  await fs.writeFile(
    file,
    JSON.stringify({ ...(JSON.parse(await fs.readFile(file, 'utf8')) as object), ...patch }),
  );
}

async function exists(target: string): Promise<boolean> {
  return fs.stat(target).then(
    () => true,
    () => false,
  );
}

const expired = () => Date.now() + DELETED_ITEM_RETENTION_MS + 60_000;

describe('recently deleted', () => {
  it('lists committed deletes of every kind, newest first, with their Undo tokens', async () => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);
    await patchManifest(projectPath, shotToken, { deletedAt: '2026-01-01T10:00:00.000Z' });
    await patchManifest(projectPath, textToken, { deletedAt: '2026-01-02T10:00:00.000Z' });

    expect(await listRecentlyDeleted(projectPath, Date.parse('2026-01-03T00:00:00.000Z'))).toEqual([
      {
        kind: 'text',
        undoToken: textToken,
        itemId: 'text_a',
        title: 'Context note',
        collectionId: COLLECTION,
        deletedAt: '2026-01-02T10:00:00.000Z',
      },
      {
        kind: 'screenshot',
        undoToken: shotToken,
        itemId: 'shot_a',
        title: 'Screen a',
        collectionId: COLLECTION,
        deletedAt: '2026-01-01T10:00:00.000Z',
      },
    ]);
  });

  it('restores a listed item through the existing Undo, after which it is no longer listed', async () => {
    const { projectPath } = await fixture();
    await deleteScreenshot(projectPath, 'shot_a');
    await deleteText(projectPath);
    const listed = await listRecentlyDeleted(projectPath);

    const shot = listed.find((item) => item.kind === 'screenshot')!;
    const restored = await undoScreenshotDelete(projectPath, await readProject(projectPath), shot.undoToken);
    expect(restored.project.screenshots.map((item) => item.id).sort()).toEqual(['shot_a', 'shot_b']);
    const text = listed.find((item) => item.kind === 'text')!;
    const restoredText = await undoContentItemDelete(
      projectPath,
      await readProject(projectPath),
      text.undoToken,
    );
    expect(restoredText.project.contentItems?.map((item) => item.id)).toEqual(['text_a']);

    expect(await listRecentlyDeleted(projectPath)).toEqual([]);
  });

  it('lists and restores drawing source and preview byte-for-byte', async () => {
    const { projectPath } = await fixture();
    const project = await readProject(projectPath);
    const item = {
      id: 'drawing_a',
      kind: 'drawing' as const,
      collectionId: COLLECTION,
      position: 3,
      includeInExport: true,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      title: 'Diagram',
      sourceFilename: 'drawing_a.json',
      imageFilename: 'drawing_a.png',
      originalWidth: 1,
      originalHeight: 1,
    };
    project.contentItems!.push(item);
    const directory = path.join(projectPath, 'collections', COLLECTION, 'drawings');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, item.sourceFilename), '{"elements":[]}');
    await fs.writeFile(path.join(directory, item.imageFilename), 'synthetic-preview');
    await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
    const { undoToken } = await deleteContentItemToTrash(projectPath, project, item.id, (target) =>
      fs.unlink(target),
    );
    expect(await listRecentlyDeleted(projectPath)).toMatchObject([
      { kind: 'drawing', undoToken, title: 'Diagram' },
    ]);
    await undoContentItemDelete(projectPath, await readProject(projectPath), undoToken);
    expect(await fs.readFile(path.join(directory, item.sourceFilename), 'utf8')).toBe('{"elements":[]}');
    expect(await fs.readFile(path.join(directory, item.imageFilename), 'utf8')).toBe('synthetic-preview');
  });

  it('reports damaged listings without changing journals', async () => {
    const { projectPath } = await fixture();
    const inFlight = await deleteScreenshot(projectPath, 'shot_a');
    const damaged = await deleteScreenshot(projectPath, 'shot_b');
    const old = await deleteText(projectPath);
    await patchManifest(projectPath, inFlight, { phase: 'trashing' });
    await fs.writeFile(path.join(journal(projectPath, damaged), 'manifest.json'), '{ not json');

    await expect(listRecentlyDeleted(projectPath)).rejects.toThrow();
    await expect(listRecentlyDeleted(projectPath, expired())).rejects.toThrow();
    for (const token of [inFlight, damaged, old])
      expect(await exists(path.join(journal(projectPath, token), 'manifest.json'))).toBe(true);
  });
});

describe('delete journal retention', () => {
  it('expires at the exact 30-day boundary, never one millisecond before it', async () => {
    const { projectPath } = await fixture();
    const token = await deleteScreenshot(projectPath, 'shot_a');
    const deletedAt = '2026-01-01T00:00:00.000Z';
    await patchManifest(projectPath, token, { deletedAt });
    const deadline = Date.parse(deletedAt) + DELETED_ITEM_RETENTION_MS;
    expect(await pruneExpiredDeletes(projectPath, {}, deadline - 1)).toEqual({ pruned: 0, failures: [] });
    expect(await exists(journal(projectPath, token))).toBe(true);
    expect(await pruneExpiredDeletes(projectPath, {}, deadline)).toEqual({ pruned: 1, failures: [] });
    expect(await exists(journal(projectPath, token))).toBe(false);
  });

  it('keeps journals inside the retention window', async () => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);

    expect(
      await pruneExpiredDeletes(projectPath, {}, Date.now() + DELETED_ITEM_RETENTION_MS - 60_000),
    ).toEqual({ pruned: 0, failures: [] });
    expect(await exists(journal(projectPath, shotToken))).toBe(true);
    expect(await exists(journal(projectPath, textToken))).toBe(true);
  });

  it('prunes committed deletes older than the retention window and leaves the project openable', async () => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);

    expect(await pruneExpiredDeletes(projectPath, {}, expired())).toEqual({ pruned: 2, failures: [] });

    expect(await exists(journal(projectPath, shotToken))).toBe(false);
    expect(await exists(journal(projectPath, textToken))).toBe(false);
    expect(await recoverScreenshotTrashTransactions(projectPath)).toEqual([]);
    expect(await recoverContentTrashTransactions(projectPath)).toEqual([]);
    const project = await readProject(projectPath);
    expect(project.screenshots.map((item) => item.id)).toEqual(['shot_b']);
    expect(project.contentItems).toEqual([]);
  });

  it.each(PHASES_IN_FLIGHT)('never prunes an expired journal in the %s phase', async (phase) => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);
    await patchManifest(projectPath, shotToken, { phase });
    // A restored content manifest is only valid with its commit receipt; without one it is
    // unreadable, which must also be left alone.
    await patchManifest(projectPath, textToken, { phase });
    const before = [
      await fs.readdir(journal(projectPath, shotToken)),
      await fs.readdir(journal(projectPath, textToken)),
    ];

    const outcome = await pruneExpiredDeletes(projectPath, {}, expired());
    expect(outcome.pruned).toBe(0);
    expect(outcome.failures).toHaveLength(phase === 'restored' ? 1 : 0);

    expect(await fs.readdir(journal(projectPath, shotToken))).toEqual(before[0]);
    expect(await fs.readdir(journal(projectPath, textToken))).toEqual(before[1]);
  });

  it('never prunes unreadable journals or journals without a readable deletion time', async () => {
    const { projectPath } = await fixture();
    const damaged = await deleteScreenshot(projectPath, 'shot_a');
    const undated = await deleteText(projectPath);
    await fs.writeFile(path.join(journal(projectPath, damaged), 'manifest.json'), '{ not json');
    await patchManifest(projectPath, undated, { deletedAt: 'not a date' });

    expect(await pruneExpiredDeletes(projectPath, {}, expired())).toMatchObject({
      pruned: 0,
      failures: [expect.any(Error)],
    });

    expect(await exists(path.join(journal(projectPath, damaged), 'image.bin'))).toBe(true);
    expect(await exists(path.join(journal(projectPath, undated), 'content-0000.bin'))).toBe(true);
  });

  it('keeps a journal that contains an unknown file and reports the failure without rejecting', async () => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);
    await fs.writeFile(path.join(journal(projectPath, shotToken), 'notes.txt'), 'mine');
    await fs.writeFile(path.join(journal(projectPath, textToken), 'notes.txt'), 'mine');

    const result = await pruneExpiredDeletes(projectPath, {}, expired());

    expect(result.pruned).toBe(0);
    expect(result.failures).toHaveLength(2);
    expect(await exists(path.join(journal(projectPath, shotToken), 'image.bin'))).toBe(true);
    expect(await exists(path.join(journal(projectPath, textToken), 'content-0000.bin'))).toBe(true);
  });

  it('retires before cleanup and preserves expired remnants after a partial cleanup failure', async () => {
    const { projectPath } = await fixture();
    const shotToken = await deleteScreenshot(projectPath, 'shot_a');
    const textToken = await deleteText(projectPath);
    const failing = {
      write: atomicWrite,
      removeDirectory: async (target: string) => {
        expect(path.basename(target)).toMatch(/^expired-/);
        const files = await fs.readdir(target);
        await fs.unlink(path.join(target, files[0]));
        throw Object.assign(new Error('locked'), { code: 'EBUSY' });
      },
    };
    const interrupted = await pruneExpiredDeletes(
      projectPath,
      { screenshots: failing, content: failing },
      expired(),
    );
    expect(interrupted.pruned).toBe(0);
    expect(interrupted.failures).toHaveLength(2);
    expect(await recoverScreenshotTrashTransactions(projectPath)).toEqual([]);
    expect(await recoverContentTrashTransactions(projectPath)).toEqual([]);
    expect(await listRecentlyDeleted(projectPath)).toEqual([]);
    for (const token of [shotToken, textToken]) {
      const parent = path.dirname(journal(projectPath, token));
      const [retired] = await fs.readdir(parent);
      expect(retired).toContain('expired-' + token);
      const before = await fs.readdir(path.join(parent, retired));
      expect(before.length).toBeGreaterThan(0);
      await pruneExpiredDeletes(projectPath, {}, expired());
      expect(await fs.readdir(path.join(parent, retired))).toEqual(before);
    }
  });

  it.each([
    'missing-blob',
    'corrupt-blob',
    'missing-collection',
    'foreign-project',
    'occupied-path',
    'unreferenced-blob',
    'linked-blob',
  ])(
    'preserves expired screenshot and content recovery data when %s makes it unsafe or unrestorable',
    async (failure) => {
      const { projectPath } = await fixture();
      const shotToken = await deleteScreenshot(projectPath, 'shot_a');
      const textToken = await deleteText(projectPath);
      if (failure === 'missing-collection' || failure === 'foreign-project') {
        const project = await readProject(projectPath);
        if (failure === 'missing-collection') {
          project.collections = [];
          project.screenshots = [];
        } else project.id = 'another_project';
        await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
      }
      for (const [token, blob, live] of [
        [shotToken, 'image.bin', `collections/${COLLECTION}/screenshots/a.png`],
        [textToken, 'content-0000.bin', `collections/${COLLECTION}/text/text_a.md`],
      ]) {
        const dir = journal(projectPath, token);
        if (failure === 'missing-blob') await fs.unlink(path.join(dir, blob));
        if (failure === 'corrupt-blob') await fs.writeFile(path.join(dir, blob), 'corrupt');
        if (failure === 'occupied-path') await fs.writeFile(path.join(projectPath, live), 'external');
        if (failure === 'unreferenced-blob')
          await fs.writeFile(path.join(dir, 'content-9999.bin'), 'manual recovery');
        if (failure === 'linked-blob') {
          await fs.unlink(path.join(dir, blob));
          const outside = path.join(projectPath, 'outside-' + token);
          await fs.mkdir(outside);
          await fs.symlink(outside, path.join(dir, blob), process.platform === 'win32' ? 'junction' : 'dir');
        }
      }
      const before = await Promise.all(
        [shotToken, textToken].map((token) => fs.readdir(journal(projectPath, token))),
      );
      const result = await pruneExpiredDeletes(projectPath, {}, expired());
      expect(result.pruned).toBe(0);
      expect(result.failures).toHaveLength(2);
      expect(
        await Promise.all([shotToken, textToken].map((token) => fs.readdir(journal(projectPath, token)))),
      ).toEqual(before);
    },
  );

  it('leaves quarantined records alone while pruning healthy expired records', async () => {
    const { projectPath } = await fixture();
    const tokens = [await deleteScreenshot(projectPath, 'shot_a'), await deleteText(projectPath)];
    for (const token of tokens) {
      const quarantine = path.join(path.dirname(journal(projectPath, token)), 'damaged-' + token);
      await fs.mkdir(quarantine);
      await fs.writeFile(path.join(quarantine, 'keep.bin'), 'manual recovery');
    }
    expect(await pruneExpiredDeletes(projectPath, {}, expired())).toEqual({ pruned: 2, failures: [] });
    for (const token of tokens)
      expect(
        await fs.readFile(
          path.join(path.dirname(journal(projectPath, token)), 'damaged-' + token, 'keep.bin'),
          'utf8',
        ),
      ).toBe('manual recovery');
  });

  it('preserves a journal whose phase changes while expiry is being prepared', async () => {
    const { projectPath } = await fixture();
    const token = await deleteScreenshot(projectPath, 'shot_a');
    const readdir = fs.readdir.bind(fs);
    let changed = false;
    vi.spyOn(fs, 'readdir').mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      const entries = await readdir(...args);
      if (String(args[0]) === journal(projectPath, token) && !changed) {
        changed = true;
        await patchManifest(projectPath, token, { phase: 'undoing' });
      }
      return entries;
    });
    const result = await pruneExpiredDeletes(projectPath, {}, expired());
    expect(result.pruned).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(await exists(path.join(journal(projectPath, token), 'image.bin'))).toBe(true);
  });

  it('reports a missing project instead of rejecting', async () => {
    const { projectPath } = await fixture();
    const result = await pruneExpiredDeletes(path.join(projectPath, 'missing'), {}, expired());
    expect(result.pruned).toBe(0);
    expect(result.failures).toHaveLength(2);
  });
});

describe('project duplication', () => {
  it('leaves undo journals, transaction journals and session recovery behind', async () => {
    const { projectPath } = await fixture();
    await deleteScreenshot(projectPath, 'shot_a');
    await deleteText(projectPath);
    await fs.mkdir(path.join(projectPath, '.imnota-transactions', 'txn-1'), { recursive: true });
    await fs.writeFile(path.join(projectPath, '.imnota-transactions', 'txn-1', 'manifest.json'), '{}');
    await fs.writeFile(path.join(projectPath, '.imnota-recovery.json'), '{}');
    await fs.writeFile(path.join(projectPath, '.imnota-recovery-backup.json'), '{}');
    // Quarantined and in-flight records belong to the source even when unreadable.
    const privateRecords = [
      ['.imnota-undo', 'damaged-screenshot', 'image.bin'],
      ['.imnota-content-undo', 'damaged-content', 'source.bin'],
      ['.imnota-transactions', 'damaged-transaction', 'before.bin'],
      ['.imnota-transactions', 'pending-transaction', 'manifest.json'],
    ];
    for (const segments of privateRecords) {
      const record = path.join(projectPath, ...segments);
      await fs.mkdir(path.dirname(record), { recursive: true });
      await fs.writeFile(record, `source recovery: ${segments.join('/')}`);
    }
    // Same names deeper in the tree are ordinary project content and must still be copied.
    await fs.mkdir(path.join(projectPath, 'collections', COLLECTION, '.imnota-undo'));
    await fs.writeFile(path.join(projectPath, 'collections', COLLECTION, '.imnota-undo', 'keep.txt'), 'x');
    const target = `${projectPath}-copy`;
    temporary.push(target);

    await copyProjectForDuplicate(projectPath, target, {
      ...(await readProject(projectPath)),
      id: 'project_duplicate',
    });

    expect((await fs.readdir(target)).sort()).toEqual(['collections', 'project.json']);
    expect(await exists(path.join(target, 'collections', COLLECTION, '.imnota-undo', 'keep.txt'))).toBe(true);
    expect(await exists(path.join(target, 'collections', COLLECTION, 'screenshots', 'b.png'))).toBe(true);
    // The source keeps its own recovery state byte-for-byte, including damaged/pending data.
    expect(await listRecentlyDeleted(projectPath)).toHaveLength(2);
    for (const segments of privateRecords) {
      expect(await fs.readFile(path.join(projectPath, ...segments), 'utf8')).toBe(
        `source recovery: ${segments.join('/')}`,
      );
      expect(await exists(path.join(target, ...segments))).toBe(false);
    }

    // The duplicate gets a new identity; with the source's journals it would refuse to open.
    const copy = await readProject(target);
    copy.id = 'project_duplicate';
    await fs.writeFile(path.join(target, 'project.json'), JSON.stringify(copy, null, 2));
    expect(await recoverScreenshotTrashTransactions(target)).toEqual([]);
    expect(await recoverContentTrashTransactions(target)).toEqual([]);
    expect(await listRecentlyDeleted(target)).toEqual([]);
  });
});

describe('open retention failure boundaries', () => {
  it.each(['file', 'link'] as const)(
    'keeps open available and all journals/grants when a token-shaped %s prevents listing',
    async (kind) => {
      const { projectPath } = await fixture();
      const shot = await deleteScreenshot(projectPath, 'shot_a');
      const old = await deleteText(projectPath);
      await patchManifest(projectPath, old, { deletedAt: '2020-01-01T00:00:00.000Z' });
      const unsafe = path.join(projectPath, '.imnota-undo', 'delete-12345678-1234-4234-8234-123456789abc');
      const outside = path.join(projectPath, 'outside');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'keep'), 'linked target');
      if (kind === 'file') await fs.writeFile(unsafe, 'unsafe token file');
      else await fs.symlink(outside, unsafe, process.platform === 'win32' ? 'junction' : 'dir');
      const metadata = await fs.readFile(path.join(projectPath, 'project.json'));
      const originalJournals = await Promise.all(
        [shot, old].map(async (token) =>
          Promise.all(
            (await fs.readdir(journal(projectPath, token))).map(
              async (name) =>
                [name, await fs.readFile(path.join(journal(projectPath, token), name))] as const,
            ),
          ),
        ),
      );
      const recovered = await recoverScreenshotTrashTransactions(projectPath);
      const content = await recoverContentTrashTransactions(projectPath);
      const result = await applyOpenDeleteRetention(projectPath);
      expect(result.warnings).toEqual([expect.stringMatching(/could not be listed.*retention was skipped/)]);
      expect(result.retired.size).toBe(0);
      expect(recovered.filter((item) => !result.retired.has(item.undoToken))).toMatchObject([
        { undoToken: shot, undoAvailable: true },
      ]);
      expect(content.filter((item) => !result.retired.has(item.undoToken))).toMatchObject([
        { undoToken: old, undoAvailable: true },
      ]);
      expect(await readProject(projectPath)).toMatchObject({
        screenshots: [expect.objectContaining({ id: 'shot_b' })],
      });
      expect(await fs.readFile(path.join(projectPath, 'project.json'))).toEqual(metadata);
      for (const [index, token] of [shot, old].entries())
        for (const [name, bytes] of originalJournals[index])
          expect(await fs.readFile(path.join(journal(projectPath, token), name))).toEqual(bytes);
      expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('linked target');
      expect((await fs.lstat(unsafe)).isSymbolicLink()).toBe(kind === 'link');
    },
  );

  it('revokes only validated retired grants, including failed cleanup, keeping uncertain expired grants', async () => {
    const { projectPath } = await fixture();
    const shot = await deleteScreenshot(projectPath, 'shot_a');
    const old = await deleteText(projectPath);
    await fs.writeFile(path.join(journal(projectPath, old), 'unexpected'), 'keep');
    const result = await applyOpenDeleteRetention(
      projectPath,
      {
        screenshots: {
          write: atomicWrite,
          removeDirectory: async () => {
            throw new Error('locked');
          },
        },
      },
      expired(),
    );
    expect([...result.retired]).toEqual([shot]);
    expect(result.failures).toHaveLength(2);
    expect(result.warnings).toHaveLength(1);
    expect(await exists(journal(projectPath, old))).toBe(true);
    expect((await fs.readdir(path.join(projectPath, '.imnota-undo')))[0]).toContain(`expired-${shot}`);
  });
});

describe('duplicate failure boundaries', () => {
  it.each(['link', 'copy-permission', 'publication', 'cleanup', 'swapped-target'] as const)(
    'does not publish the source identity after %s failure or damage source/unrelated files',
    async (failure) => {
      const { projectPath, project } = await fixture();
      const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-duplicate-failure-'));
      temporary.push(workspace);
      const target = path.join(workspace, 'duplicate');
      const outside = path.join(workspace, 'unrelated');
      await fs.mkdir(outside);
      await fs.writeFile(path.join(outside, 'keep'), 'untouched');
      const sourceBytes = await fs.readFile(path.join(projectPath, 'project.json'));
      const imagePath = path.join(projectPath, 'collections', COLLECTION, 'screenshots', 'a.png');
      const image = await fs.readFile(imagePath);
      const realCopy = fs.cp.bind(fs);
      vi.spyOn(fs, 'cp').mockImplementationOnce(async (source, destination, options) => {
        // Force the failure after actual file copying, independent of readdir ordering.
        await realCopy(path.join(projectPath, 'collections'), path.join(target, 'collections'), {
          recursive: true,
        });
        expect(
          await fs.readFile(path.join(target, 'collections', COLLECTION, 'screenshots', 'a.png')),
        ).toEqual(image);
        expect(await exists(path.join(target, 'project.json'))).toBe(false);
        if (failure === 'link') {
          const link = path.join(projectPath, 'collections', COLLECTION, 'linked');
          await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
          // Exercise the real production filter on a nested junction/symlink.
          await realCopy(link, path.join(target, 'linked'), options);
        }
        if (failure === 'swapped-target') {
          await fs.rename(target, path.join(workspace, 'retained-owned'));
          await fs.symlink(outside, target, process.platform === 'win32' ? 'junction' : 'dir');
        }
        if (failure !== 'publication') throw Object.assign(new Error('copy refused'), { code: 'EACCES' });
      });
      if (failure === 'publication') {
        const write = fs.writeFile.bind(fs);
        vi.spyOn(fs, 'writeFile').mockImplementation(async (file, data, options) => {
          if (file === path.join(target, 'project.json'))
            throw Object.assign(new Error('publication denied'), { code: 'EPERM' });
          return write(file, data, options);
        });
      }
      if (failure === 'cleanup')
        vi.spyOn(fs, 'rmdir').mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EACCES' }));
      await expect(
        copyProjectForDuplicate(projectPath, target, { ...project, id: 'project_copy' }),
      ).rejects.toThrow(
        failure === 'cleanup' || failure === 'swapped-target'
          ? /retained.*manual inspection/
          : /Linked|copy refused|publication denied/,
      );
      expect(await listWorkspaceProjects(workspace)).toEqual([]);
      expect(await fs.readFile(path.join(projectPath, 'project.json'))).toEqual(sourceBytes);
      expect(await fs.readFile(imagePath)).toEqual(image);
      expect(await fs.readFile(path.join(outside, 'keep'), 'utf8')).toBe('untouched');
      if (failure === 'link' || failure === 'copy-permission' || failure === 'publication')
        expect(await exists(target)).toBe(false);
      if (failure === 'swapped-target') expect((await fs.lstat(target)).isSymbolicLink()).toBe(true);
    },
  );

  it('preserves preexisting destinations and refuses the original identity', async () => {
    const { projectPath, project } = await fixture();
    const target = projectPath + '-preexisting';
    temporary.push(target);
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'keep'), 'mine');
    await expect(
      copyProjectForDuplicate(projectPath, target, { ...project, id: 'project_copy' }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await fs.readFile(path.join(target, 'keep'), 'utf8')).toBe('mine');
    await expect(copyProjectForDuplicate(projectPath, projectPath + '-unused', project)).rejects.toThrow(
      /new project identity/,
    );
    expect(await exists(projectPath + '-unused')).toBe(false);
  });
});
