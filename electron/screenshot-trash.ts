import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { screenshotSchema, validateProject } from '../src/shared/schema.js';
import { nowIso } from '../src/shared/utils.js';
import { assertNoLinks, atomicWrite, isWithin } from './files.js';
import { screenshotPath } from './collections.js';

interface DeleteManifest {
  screenshot: ScreenshotRecord;
  deletedAt: string;
}

export interface ScreenshotTrashOperations {
  write: typeof atomicWrite;
  removeDirectory: (target: string) => Promise<void>;
}

const defaultOperations: ScreenshotTrashOperations = {
  write: atomicWrite,
  removeDirectory: (target) => fs.rm(target, { recursive: true, force: true }),
};

function undoDirectory(projectPath: string, token: string): string {
  const target = path.resolve(projectPath, '.imnota-undo', token);
  if (!isWithin(path.join(projectPath, '.imnota-undo'), target)) throw new Error('Invalid Undo token.');
  return target;
}

function contentPaths(projectPath: string, screenshot: ScreenshotRecord) {
  return {
    image: screenshotPath(projectPath, screenshot),
    annotations: path.join(projectPath, screenshot.annotationFile),
    description: path.join(projectPath, screenshot.descriptionFile),
  };
}

function backupPaths(directory: string, screenshot: ScreenshotRecord) {
  return {
    image: path.join(directory, `image${path.extname(screenshot.storedFilename) || '.png'}`),
    annotations: path.join(directory, 'annotations.json'),
    description: path.join(directory, 'description.md'),
  };
}

async function exists(target: string): Promise<boolean> {
  return Boolean(await fs.stat(target).catch(() => null));
}

async function restoreMissingFiles(
  source: ReturnType<typeof backupPaths>,
  destination: ReturnType<typeof contentPaths>,
  restored: string[],
  operations: ScreenshotTrashOperations,
): Promise<void> {
  for (const key of ['image', 'annotations', 'description'] as const) {
    await assertNoLinks(source[key]);
    await assertNoLinks(destination[key]);
    if (!(await exists(destination[key]))) {
      await operations.write(destination[key], await fs.readFile(source[key]));
      restored.push(destination[key]);
    }
  }
}

function withoutScreenshot(project: ProjectData, screenshot: ScreenshotRecord): ProjectData {
  const collectionShots = project.screenshots
    .filter((item) => item.collectionId === screenshot.collectionId && item.id !== screenshot.id)
    .sort((a, b) => a.position - b.position)
    .map((item, position) => ({ ...item, position }));
  let cursor = 0;
  return {
    ...project,
    updatedAt: nowIso(),
    screenshots: project.screenshots
      .filter((item) => item.id !== screenshot.id)
      .map((item) => (item.collectionId === screenshot.collectionId ? collectionShots[cursor++] : item)),
  };
}

export async function deleteScreenshotToTrash(
  projectPath: string,
  project: ProjectData,
  screenshotId: string,
  trashItem: (target: string) => Promise<void>,
  operations: ScreenshotTrashOperations = defaultOperations,
): Promise<{ project: ProjectData; undoToken: string }> {
  const screenshot = project.screenshots.find((item) => item.id === screenshotId);
  if (!screenshot) throw new Error('Screenshot not found.');
  const token = `delete-${randomUUID()}`;
  const directory = undoDirectory(projectPath, token);
  const original = contentPaths(projectPath, screenshot);
  const backup = backupPaths(directory, screenshot);
  for (const target of Object.values(original)) await assertNoLinks(target);
  await fs.mkdir(directory, { recursive: true });
  await operations.write(backup.image, await fs.readFile(original.image));
  await operations.write(
    backup.annotations,
    await fs.readFile(original.annotations).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return Buffer.from('[]');
      throw error;
    }),
  );
  await operations.write(
    backup.description,
    await fs.readFile(original.description).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return Buffer.from(screenshot.description);
      throw error;
    }),
  );
  await operations.write(
    path.join(directory, 'manifest.json'),
    JSON.stringify({ screenshot, deletedAt: nowIso() } satisfies DeleteManifest, null, 2),
  );

  try {
    for (const target of Object.values(original)) if (await exists(target)) await trashItem(target);
    const next = withoutScreenshot(project, screenshot);
    await operations.write(path.join(projectPath, 'project.json'), JSON.stringify(next, null, 2));
    return { project: next, undoToken: token };
  } catch (error) {
    await restoreMissingFiles(backup, original, [], operations);
    throw error;
  }
}

export async function undoScreenshotDelete(
  projectPath: string,
  project: ProjectData,
  token: string,
  operations: ScreenshotTrashOperations = defaultOperations,
): Promise<ProjectData> {
  const directory = undoDirectory(projectPath, token);
  await assertNoLinks(directory);
  const manifestPath = path.join(directory, 'manifest.json');
  await assertNoLinks(manifestPath);
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as DeleteManifest;
  const screenshot = screenshotSchema.parse(manifest.screenshot);
  if (
    screenshot.annotationFile !==
      `collections/${screenshot.collectionId}/annotations/${screenshot.storedFilename}.json` ||
    screenshot.descriptionFile !==
      `collections/${screenshot.collectionId}/descriptions/${screenshot.storedFilename}.md`
  )
    throw new Error('Undo manifest contains mismatched screenshot paths. Recovery files were kept.');
  if (project.screenshots.some((item) => item.id === screenshot.id))
    throw new Error('This screenshot has already been restored.');
  if (!project.collections.some((collection) => collection.id === screenshot.collectionId))
    throw new Error('The screenshot collection no longer exists.');
  const original = contentPaths(projectPath, screenshot);
  if ((await Promise.all(Object.values(original).map(exists))).some(Boolean))
    throw new Error(
      'Undo stopped because one of the original paths is now occupied. Recovery files were kept.',
    );
  const restored: string[] = [];
  let committed = false;
  let next: ProjectData;
  try {
    await restoreMissingFiles(backupPaths(directory, screenshot), original, restored, operations);
    const collectionShots = project.screenshots
      .filter((item) => item.collectionId === screenshot.collectionId)
      .sort((a, b) => a.position - b.position);
    collectionShots.splice(Math.min(screenshot.position, collectionShots.length), 0, screenshot);
    const normalized = collectionShots.map((item, position) => ({ ...item, position }));
    const normalizedById = new Map(normalized.map((item) => [item.id, item]));
    next = validateProject({
      ...project,
      updatedAt: nowIso(),
      screenshots: [...project.screenshots, screenshot].map((item) => normalizedById.get(item.id) ?? item),
    });
    await operations.write(path.join(projectPath, 'project.json'), JSON.stringify(next, null, 2));
    committed = true;
  } catch (error) {
    if (!committed) for (const target of restored) await fs.unlink(target).catch(() => undefined);
    throw error;
  }
  const resolvedDirectory = path.resolve(directory);
  if (isWithin(path.join(projectPath, '.imnota-undo'), resolvedDirectory))
    await operations.removeDirectory(resolvedDirectory).catch(() => undefined);
  return next;
}
