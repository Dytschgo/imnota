// @vitest-environment node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProject } from '../src/shared/utils.js';
import type { ProjectData, ScreenshotRecord } from '../src/shared/types.js';
import { QuickCaptureStore } from './quick-capture-store.js';
import { commitQuickCapture, type QuickCaptureCommitHost } from './quick-capture-commit.js';

const fixtures: string[] = [];
afterEach(async () => {
  for (const directory of fixtures.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const projectPath = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-quick-commit-test-')),
  );
  fixtures.push(projectPath);
  const project = emptyProject('Quick capture recovery', '');
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
  const store = new QuickCaptureStore();
  const id = store.add({
    png: Buffer.from('immutable fixture PNG'),
    width: 480,
    height: 300,
    previewDataUrl: 'fixture',
  });
  const destination = { projectPath, collectionId: project.collections[0].id };
  const read = async () =>
    JSON.parse(await fs.readFile(path.join(projectPath, 'project.json'), 'utf8')) as ProjectData;
  const host: QuickCaptureCommitHost = {
    authorize: async (target) => fs.realpath(target),
    read,
    snapshot: async () => ({
      projectPath,
      project: await read(),
      thumbnails: {},
      recoveryFound: false,
      projectRevision: 'fixture',
    }),
    insert: vi.fn<QuickCaptureCommitHost['insert']>(async (_path, collectionId, png, _admission, content) => {
      const metadata = await read();
      const timestamp = new Date().toISOString();
      const screenshot: ScreenshotRecord = {
        id: content.id,
        collectionId,
        originalFilename: 'Capture.png',
        storedFilename: 'Capture.png',
        title: 'Screen capture',
        description: '',
        position: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
        priority: 'medium',
        annotationFile: 'capture.json',
        descriptionFile: 'capture.md',
        originalWidth: 480,
        originalHeight: 300,
        includeInExport: true,
      };
      await fs.writeFile(path.join(projectPath, 'Capture.png'), png);
      await fs.writeFile(path.join(projectPath, 'capture.json'), JSON.stringify(content.annotations));
      await fs.writeFile(path.join(projectPath, 'capture.md'), '');
      metadata.screenshots.push(screenshot);
      await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(metadata));
      throw new Error('Committed write; snapshot response unavailable');
    }),
    assertAdmission: vi.fn(),
  };
  return { store, id, destination, host, read, projectPath };
}

it('reopens one committed screenshot after a lost response without rewriting files or duplicating the item', async () => {
  const { store, id, destination, host, read, projectPath } = await fixture();
  const commit = () =>
    store.commit(id, 1, destination, (item, target) => commitQuickCapture(item, target, host));
  await expect(commit()).rejects.toThrow(/snapshot response unavailable/);
  expect(store.size).toBe(1);
  expect((await read()).screenshots.map((item) => item.id)).toEqual([id]);
  const file = path.join(projectPath, 'Capture.png');
  const before = await fs.stat(file);
  await commit();
  expect(store.size).toBe(0);
  expect(host.insert).toHaveBeenCalledTimes(1);
  expect((await read()).screenshots.map((item) => item.id)).toEqual([id]);
  expect(await fs.readFile(file, 'utf8')).toBe('immutable fixture PNG');
  expect((await fs.stat(file)).mtimeMs).toBe(before.mtimeMs);
});

it('keeps the capture when its chosen project is archived before Add', async () => {
  const { store, id, destination, host, read, projectPath } = await fixture();
  const project = await read();
  project.status = 'archived';
  await fs.writeFile(path.join(projectPath, 'project.json'), JSON.stringify(project));
  await expect(
    store.commit(id, 1, destination, (item, target) => commitQuickCapture(item, target, host)),
  ).rejects.toThrow(/no longer active/);
  expect(host.insert).not.toHaveBeenCalled();
  expect(store.size).toBe(1);
  await expect(fs.stat(path.join(projectPath, 'Capture.png'))).rejects.toMatchObject({ code: 'ENOENT' });
});
