// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../../../electron/files';
import { ensureCollection, screenshotPath } from '../../../electron/collections';
import {
  deleteScreenshotToTrash,
  listScreenshotTrashTransactions,
  recoverScreenshotTrashTransactions,
  undoScreenshotDelete,
  type ScreenshotTrashOperations,
} from '../../../electron/screenshot-trash';
import { emptyProject } from '../utils';

const temporaryDirectories: string[] = [];

async function safeCleanup(directory: string): Promise<void> {
  const parent = await fs.realpath(os.tmpdir());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('imnota-trash-test-'))
    throw new Error(`Refusing unsafe fixture cleanup: ${resolved}`);
  await fs.rm(resolved, { recursive: true, force: true });
  await expect(fs.stat(resolved)).rejects.toMatchObject({ code: 'ENOENT' });
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await safeCleanup(directory);
});

async function fixture() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-trash-test-')));
  temporaryDirectories.push(dir);
  const project = emptyProject('Trash', '');
  const collectionId = project.collections[0].id;
  const screenshot = {
    collectionId,
    id: 'shot',
    originalFilename: 'screen.png',
    storedFilename: '001-screen.png',
    title: 'Screen',
    description: 'Important description',
    position: 0,
    createdAt: 'created',
    updatedAt: 'updated',
    priority: 'medium' as const,
    annotationFile: `collections/${collectionId}/annotations/001-screen.png.json`,
    descriptionFile: `collections/${collectionId}/descriptions/001-screen.png.md`,
    originalWidth: 10,
    originalHeight: 10,
    includeInExport: true,
  };
  project.screenshots = [screenshot];
  await ensureCollection(dir, collectionId);
  await atomicWrite(path.join(dir, 'project.json'), JSON.stringify(project));
  await atomicWrite(screenshotPath(dir, screenshot), Buffer.from([1, 2, 3]));
  await atomicWrite(path.join(dir, screenshot.annotationFile), '[{"id":"annotation"}]');
  await atomicWrite(path.join(dir, screenshot.descriptionFile), screenshot.description);
  const targets = {
    image: screenshotPath(dir, screenshot),
    annotations: path.join(dir, screenshot.annotationFile),
    description: path.join(dir, screenshot.descriptionFile),
    metadata: path.join(dir, 'project.json'),
  };
  const trashItem = async (target: string) => fs.unlink(target);
  return { dir, project, screenshot, targets, trashItem };
}

const defaultRemove = (target: string) => fs.rm(target, { recursive: true, force: true });

async function expectPresent(targets: Record<string, string>): Promise<void> {
  for (const [name, target] of Object.entries(targets)) {
    if (name !== 'metadata') expect(await fs.stat(target)).toBeTruthy();
  }
}

async function expectDeleted(targets: Record<string, string>): Promise<void> {
  for (const [name, target] of Object.entries(targets)) {
    if (name !== 'metadata') await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  }
}

async function screenshotCount(metadataPath: string): Promise<number> {
  return JSON.parse(await fs.readFile(metadataPath, 'utf8')).screenshots.length;
}

describe('screenshot trash and Undo transactions', () => {
  it('does not expose an incomplete backup or call trash when staging fails', async () => {
    const { dir, project, targets } = await fixture();
    let trashCalls = 0;
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (path.basename(target) === 'description.bin') throw new Error('injected staging failure');
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(
      deleteScreenshotToTrash(
        dir,
        project,
        'shot',
        async () => {
          trashCalls++;
        },
        operations,
      ),
    ).rejects.toThrow('injected staging failure');
    expect(trashCalls).toBe(0);
    await expectPresent(targets);
    expect(await screenshotCount(targets.metadata)).toBe(1);
    expect(await listScreenshotTrashTransactions(dir)).toEqual([]);
  });

  it.each(['image', 'annotations', 'description'] as const)(
    'restores the byte-exact baseline when trashing %s fails',
    async (failed) => {
      const { dir, project, targets } = await fixture();
      let injected = false;
      const trashItem = async (target: string) => {
        if (!injected && target === targets[failed]) {
          injected = true;
          throw new Error('injected trash failure');
        }
        await fs.unlink(target);
      };
      await expect(deleteScreenshotToTrash(dir, project, 'shot', trashItem)).rejects.toMatchObject({
        code: 'delete-failed',
      });
      await expectPresent(targets);
      expect(await screenshotCount(targets.metadata)).toBe(1);
      expect(await listScreenshotTrashTransactions(dir)).toMatchObject([{ phase: 'prepared' }]);
    },
  );

  it('restores every original when the metadata removal write fails', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (target === targets.metadata) throw new Error('injected metadata failure');
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(deleteScreenshotToTrash(dir, project, 'shot', trashItem, operations)).rejects.toThrow(
      'injected metadata failure',
    );
    await expectPresent(targets);
    expect(await screenshotCount(targets.metadata)).toBe(1);
  });

  it('returns a usable Undo token when metadata committed before an injected post-write error', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    let failed = false;
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        await atomicWrite(target, content);
        if (!failed && target === targets.metadata) {
          failed = true;
          throw new Error('injected post-commit error');
        }
      },
      removeDirectory: defaultRemove,
    };
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem, operations);
    expect(deleted.warning).toContain('committed');
    expect(await screenshotCount(targets.metadata)).toBe(0);
    await expectDeleted(targets);
    expect((await listScreenshotTrashTransactions(dir))[0].undoToken).toBe(deleted.undoToken);
  });

  it('preserves a rollback-failed journal and repairs it before ordinary reads', async () => {
    const { dir, project, targets } = await fixture();
    let trashFailed = false;
    let rollbackFailed = false;
    const trashItem = async (target: string) => {
      if (target === targets.annotations) {
        trashFailed = true;
        throw new Error('injected trash failure');
      }
      await fs.unlink(target);
    };
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (trashFailed && !rollbackFailed && target === targets.image) {
          rollbackFailed = true;
          throw new Error('injected rollback failure');
        }
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(deleteScreenshotToTrash(dir, project, 'shot', trashItem, operations)).rejects.toMatchObject({
      code: 'rollback-failed',
    });
    await expect(fs.stat(targets.image)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await listScreenshotTrashTransactions(dir)).toHaveLength(1);

    await expect(recoverScreenshotTrashTransactions(dir)).resolves.toMatchObject([
      { status: 'baseline-restored', undoAvailable: false },
    ]);
    await expectPresent(targets);
    expect(await screenshotCount(targets.metadata)).toBe(1);
  });

  it('recovers a persisted mid-trash manifest and missing files to the saved baseline', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    const transactionDirectory = path.join(dir, '.imnota-undo', deleted.undoToken);
    const manifestPath = path.join(transactionDirectory, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    await atomicWrite(
      targets.metadata,
      await fs.readFile(path.join(transactionDirectory, manifest.metadataBefore.blob)),
    );
    await atomicWrite(
      targets.image,
      await fs.readFile(path.join(transactionDirectory, manifest.content[0].bytes.blob)),
    );
    manifest.phase = 'trashing';
    await atomicWrite(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(recoverScreenshotTrashTransactions(dir)).resolves.toMatchObject([
      { status: 'baseline-restored', undoAvailable: false },
    ]);
    await expectPresent(targets);
    expect(await screenshotCount(targets.metadata)).toBe(1);
    expect(await listScreenshotTrashTransactions(dir)).toMatchObject([{ phase: 'prepared' }]);
  });

  it('recovers a committed deletion as an available Undo operation', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    await expect(recoverScreenshotTrashTransactions(dir)).resolves.toMatchObject([
      {
        undoToken: deleted.undoToken,
        status: 'deletion-committed',
        undoAvailable: true,
      },
    ]);
    await expectDeleted(targets);
    expect(await screenshotCount(targets.metadata)).toBe(0);
  });

  it.each(['image', 'annotations', 'description', 'metadata'] as const)(
    'rolls a failed %s Undo write back to deleted state so it can be retried',
    async (failed) => {
      const { dir, project, targets, trashItem } = await fixture();
      const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
      let injected = false;
      const operations: ScreenshotTrashOperations = {
        write: async (target, content) => {
          if (!injected && target === targets[failed]) {
            injected = true;
            throw new Error('injected Undo write failure');
          }
          await atomicWrite(target, content);
        },
        removeDirectory: defaultRemove,
      };
      await expect(
        undoScreenshotDelete(dir, deleted.project, deleted.undoToken, operations),
      ).rejects.toMatchObject({ code: 'undo-failed' });
      await expectDeleted(targets);
      expect(await screenshotCount(targets.metadata)).toBe(0);

      const restored = await undoScreenshotDelete(dir, deleted.project, deleted.undoToken);
      expect(restored.project.screenshots.map((item) => item.id)).toContain('shot');
      expect(restored.cleanup).toBe('complete');
      await expectPresent(targets);
    },
  );

  it('recovers a rollback-failed partial Undo and permits retry', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    let candidateFailed = false;
    let rollbackFailed = false;
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (target === targets.annotations) {
          candidateFailed = true;
          throw new Error('injected candidate failure');
        }
        await atomicWrite(target, content);
      },
      unlink: async (target) => {
        if (candidateFailed && !rollbackFailed && target === targets.image) {
          rollbackFailed = true;
          throw new Error('injected Undo rollback failure');
        }
        await fs.unlink(target);
      },
      removeDirectory: defaultRemove,
    };
    await expect(
      undoScreenshotDelete(dir, deleted.project, deleted.undoToken, operations),
    ).rejects.toMatchObject({ code: 'rollback-failed' });
    expect(await fs.stat(targets.image)).toBeTruthy();
    expect(await screenshotCount(targets.metadata)).toBe(0);

    await expect(recoverScreenshotTrashTransactions(dir)).resolves.toMatchObject([
      { status: 'deletion-committed', undoAvailable: true },
    ]);
    await expectDeleted(targets);
    const restored = await undoScreenshotDelete(dir, deleted.project, deleted.undoToken);
    expect(restored.project.screenshots).toHaveLength(1);
  });

  it('keeps restored content referenced when post-commit recovery cleanup fails', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    const operations: ScreenshotTrashOperations = {
      write: atomicWrite,
      removeDirectory: async () => {
        throw new Error('injected cleanup failure');
      },
    };
    const restored = await undoScreenshotDelete(dir, deleted.project, deleted.undoToken, operations);
    expect(restored.project.screenshots.map((item) => item.id)).toContain('shot');
    expect(restored.cleanup).toBe('pending');
    await expectPresent(targets);
    expect(await screenshotCount(targets.metadata)).toBe(1);
    expect(await fs.stat(path.join(dir, '.imnota-undo', deleted.undoToken))).toBeTruthy();

    await expect(recoverScreenshotTrashTransactions(dir)).resolves.toMatchObject([
      { status: 'undo-committed', cleanup: 'complete', undoAvailable: false },
    ]);
    expect(await listScreenshotTrashTransactions(dir)).toEqual([]);
  });

  it('aborts Undo on metadata drift and preserves the recoverable backup', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    await atomicWrite(targets.metadata, Buffer.from(JSON.stringify({ external: true })));
    await expect(undoScreenshotDelete(dir, deleted.project, deleted.undoToken)).rejects.toMatchObject({
      code: 'baseline-changed',
    });
    expect(await fs.readFile(targets.metadata, 'utf8')).toContain('external');
    expect(await listScreenshotTrashTransactions(dir)).toHaveLength(1);
  });

  it('aborts Undo on an occupied content path and preserves both versions', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    await atomicWrite(targets.image, Buffer.from('external-version'));
    await expect(undoScreenshotDelete(dir, deleted.project, deleted.undoToken)).rejects.toMatchObject({
      code: 'baseline-changed',
    });
    expect(await fs.readFile(targets.image, 'utf8')).toBe('external-version');
    expect(await listScreenshotTrashTransactions(dir)).toHaveLength(1);
  });

  it('rejects a manifest whose content paths do not canonically belong to its screenshot', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    const manifestPath = path.join(dir, '.imnota-undo', deleted.undoToken, 'manifest.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.screenshot.descriptionFile = 'collections/another-collection/descriptions/001-screen.png.md';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));

    await expect(undoScreenshotDelete(dir, deleted.project, deleted.undoToken)).rejects.toThrow(
      'mismatched screenshot paths',
    );
    await expectDeleted(targets);
    expect(await screenshotCount(targets.metadata)).toBe(0);
    expect(await fs.stat(path.dirname(manifestPath))).toBeTruthy();
  });

  it('rejects a linked Undo root before writing through it', async () => {
    const { dir, project } = await fixture();
    const outside = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-trash-test-')));
    temporaryDirectories.push(outside);
    await fs.symlink(
      outside,
      path.join(dir, '.imnota-undo'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      deleteScreenshotToTrash(dir, project, 'shot', async (target) => fs.unlink(target)),
    ).rejects.toThrow('Linked');
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('rejects malformed and aliased Undo tokens', async () => {
    const { dir, project } = await fixture();
    for (const token of ['../delete-token', 'delete-token', 'DELETE-00000000-0000-4000-8000-000000000000'])
      await expect(undoScreenshotDelete(dir, project, token)).rejects.toMatchObject({
        code: 'invalid-token',
      });
  });
});
