// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject } from '../src/shared/utils.js';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { ensureCollection, screenshotPath } from './collections.js';
import { atomicWrite } from './files.js';
import { registerScreenshotIpc } from './ipc-screenshots.js';
import type { IpcRouter } from './ipc-router.js';
import type { IpcHost } from './main.js';
import { importScreenshot } from './screenshot-import.js';

vi.mock('electron', () => ({
  app: {},
  shell: {},
  nativeImage: { createFromPath: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) },
}));
vi.mock('./native-clipboard.js', () => ({ nativeClipboard: {} }));

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const projectPath = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-created-files-')));
  directories.push(projectPath);
  const project = emptyProject('Cleanup', '');
  const collectionId = project.collections[0].id;
  const source: ScreenshotRecord = {
    id: 'shot_source',
    collectionId,
    originalFilename: 'source.png',
    storedFilename: 'source.png',
    title: 'Source',
    description: 'Keep this description',
    position: 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    priority: 'medium',
    annotationFile: `collections/${collectionId}/annotations/source.png.json`,
    descriptionFile: `collections/${collectionId}/descriptions/source.png.md`,
    originalWidth: 1,
    originalHeight: 1,
    includeInExport: true,
  };
  project.screenshots.push(source);
  await ensureCollection(projectPath, collectionId);
  const originalFiles = [
    [screenshotPath(projectPath, source), 'source image'],
    [path.join(projectPath, source.annotationFile), '[]'],
    [path.join(projectPath, source.descriptionFile), source.description],
    [path.join(projectPath, 'project.json'), JSON.stringify(project, null, 2)],
  ];
  for (const [target, contents] of originalFiles) await fs.writeFile(target, contents);
  const originalError = new Error('Injected project save failure');
  const rename = fs.rename.bind(fs);
  vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
    if (to === path.join(projectPath, 'project.json')) throw originalError;
    await rename(from, to);
  });
  const host = {
    atomicWrite,
    readProject: async (): Promise<ProjectData> =>
      JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')),
    uniqueStoredName: async () => 'new.png',
    nextScreenshotPosition: () => 1,
  } satisfies Pick<IpcHost, 'atomicWrite' | 'readProject' | 'uniqueStoredName' | 'nextScreenshotPosition'>;
  const expectUnchanged = async () => {
    for (const folder of ['screenshots', 'annotations', 'descriptions']) {
      const suffix = folder === 'annotations' ? '.json' : folder === 'descriptions' ? '.md' : '';
      expect(await fs.readdir(path.join(projectPath, 'collections', collectionId, folder))).toEqual([
        `source.png${suffix}`,
      ]);
    }
    for (const [target, contents] of originalFiles) expect(await fs.readFile(target, 'utf8')).toBe(contents);
  };
  return { projectPath, source, host, originalError, expectUnchanged };
}

it('removes imported files and preserves the original error when the project save fails', async () => {
  const { projectPath, source, host, originalError, expectUnchanged } = await fixture();
  await expect(importScreenshot(host, projectPath, screenshotPath(projectPath, source))).rejects.toBe(
    originalError,
  );
  await expectUnchanged();
});

it('removes duplicated files and preserves the original error when the project save fails', async () => {
  const { projectPath, source, host, originalError, expectUnchanged } = await fixture();
  type Duplicate = (
    event: IpcMainInvokeEvent,
    input: { projectPath: string; screenshot: ScreenshotRecord },
  ) => Promise<unknown>;
  let duplicate!: Duplicate;
  registerScreenshotIpc(
    {
      handle: (channel: string, handler: Duplicate) => {
        if (channel === 'screenshots:duplicate') duplicate = handler;
      },
    } as unknown as IpcRouter,
    {
      ...host,
      assertProjectPath: async () => projectPath,
      copyFile: fs.copyFile,
    } satisfies Partial<IpcHost> as unknown as IpcHost,
  );
  await expect(duplicate({} as IpcMainInvokeEvent, { projectPath, screenshot: source })).rejects.toBe(
    originalError,
  );
  await expectUnchanged();
});
