// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atomicWrite } from '../../../electron/files';
import { ensureCollection, screenshotPath } from '../../../electron/collections';
import {
  deleteScreenshotToTrash,
  undoScreenshotDelete,
  type ScreenshotTrashOperations,
} from '../../../electron/screenshot-trash';
import { emptyProject } from '../utils';

const temporary: string[] = [];
afterEach(async () => {
  for (const folder of temporary.splice(0)) await fs.rm(folder, { recursive: true, force: true });
});

async function fixture() {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-trash-test-')));
  temporary.push(dir);
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
  const targets = [
    screenshotPath(dir, screenshot),
    path.join(dir, screenshot.annotationFile),
    path.join(dir, screenshot.descriptionFile),
  ];
  const trashItem = async (target: string) => fs.unlink(target);
  return { dir, project, screenshot, targets, trashItem };
}

const defaultRemove = (target: string) => fs.rm(target, { recursive: true, force: true });

describe('screenshot trash and Undo transactions', () => {
  it('restores every original when metadata removal fails after files were trashed', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (target === path.join(dir, 'project.json')) throw new Error('injected metadata failure');
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(deleteScreenshotToTrash(dir, project, 'shot', trashItem, operations)).rejects.toThrow(
      'injected metadata failure',
    );
    for (const target of targets) expect(await fs.stat(target)).toBeTruthy();
    expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).screenshots).toHaveLength(1);
  });

  it('cleans a partial restore so Undo can be retried', async () => {
    const { dir, project, screenshot, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (target === path.join(dir, screenshot.annotationFile)) throw new Error('injected copy failure');
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(undoScreenshotDelete(dir, deleted.project, deleted.undoToken, operations)).rejects.toThrow(
      'injected copy failure',
    );
    for (const target of targets) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const restored = await undoScreenshotDelete(dir, deleted.project, deleted.undoToken);
    expect(restored.screenshots.map((item) => item.id)).toContain('shot');
  });

  it('rolls restored files back when the Undo metadata commit fails', async () => {
    const { dir, project, targets, trashItem } = await fixture();
    const deleted = await deleteScreenshotToTrash(dir, project, 'shot', trashItem);
    const operations: ScreenshotTrashOperations = {
      write: async (target, content) => {
        if (target === path.join(dir, 'project.json')) throw new Error('injected commit failure');
        await atomicWrite(target, content);
      },
      removeDirectory: defaultRemove,
    };
    await expect(undoScreenshotDelete(dir, deleted.project, deleted.undoToken, operations)).rejects.toThrow(
      'injected commit failure',
    );
    for (const target of targets) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
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
    expect(restored.screenshots.map((item) => item.id)).toContain('shot');
    for (const target of targets) expect(await fs.stat(target)).toBeTruthy();
    expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).screenshots).toHaveLength(1);
    expect(await fs.stat(path.join(dir, '.imnota-undo', deleted.undoToken))).toBeTruthy();
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

    for (const target of targets) await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(JSON.parse(await fs.readFile(path.join(dir, 'project.json'), 'utf8')).screenshots).toHaveLength(0);
    expect(await fs.stat(path.dirname(manifestPath))).toBeTruthy();
  });
});
