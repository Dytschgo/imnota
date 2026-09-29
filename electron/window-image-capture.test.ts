// @vitest-environment node
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureElectronWindowPng,
  captureMacWindowPng,
  type GetWindowSources,
} from './window-image-capture.js';

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest'),
]);
const roots: string[] = [];

async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'imnota-window-test-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('macOS window image capture', () => {
  it('captures the window by id without shadow or sound and removes its temporary file', async () => {
    const root = await temporaryRoot();
    const run = vi.fn(async (args: readonly string[]) => writeFile(args.at(-1)!, png));
    await expect(captureMacWindowPng('window:1234', run, root)).resolves.toEqual(png);
    const args = run.mock.calls[0]![0];
    expect(args.slice(0, 5)).toEqual(['-x', '-o', '-t', 'png', '-l1234']);
    expect(await readdir(root)).toEqual([]);
  });

  it('falls back when the id is not a window number, the tool fails or the output is not a PNG', async () => {
    const root = await temporaryRoot();
    const run = vi.fn(async (args: readonly string[]) => writeFile(args.at(-1)!, png));
    await expect(captureMacWindowPng('window:12;rm', run, root)).resolves.toBeNull();
    await expect(captureMacWindowPng('screen:1', run, root)).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
    await expect(
      captureMacWindowPng('window:7', async () => Promise.reject(new Error('denied')), root),
    ).resolves.toBeNull();
    await expect(
      captureMacWindowPng('window:7', async (args) => writeFile(args.at(-1)!, 'not a png'), root),
    ).resolves.toBeNull();
    expect(await readdir(root)).toEqual([]);
  });
});

describe('Electron window image capture', () => {
  const image = (empty = false) => ({ isEmpty: () => empty, toPNG: () => png });

  it('requests the window at its physical size and matches the source by window id', async () => {
    const getSources = vi.fn<GetWindowSources>(async () => [
      { id: 'window:12345:0', thumbnail: image() },
      { id: 'window:1234:2', thumbnail: image() },
    ]);
    await expect(
      captureElectronWindowPng('window:1234', { x: 10, y: 20, width: 800, height: 600 }, 1.5, getSources),
    ).resolves.toEqual(png);
    expect(getSources).toHaveBeenCalledWith({
      types: ['window'],
      thumbnailSize: { width: 1200, height: 900 },
      fetchWindowIcons: false,
    });
  });

  it('falls back when the window is gone, empty or the capture fails', async () => {
    const bounds = { x: 0, y: 0, width: 100, height: 100 };
    await expect(
      captureElectronWindowPng('window:1', bounds, 1, async () => [
        { id: 'window:11:0', thumbnail: image() },
      ]),
    ).resolves.toBeNull();
    await expect(
      captureElectronWindowPng('window:1', bounds, 1, async () => [
        { id: 'window:1:0', thumbnail: image(true) },
      ]),
    ).resolves.toBeNull();
    await expect(
      captureElectronWindowPng('window:1', bounds, 1, async () => Promise.reject(new Error('busy'))),
    ).resolves.toBeNull();
    await expect(captureElectronWindowPng('front', bounds, 1, async () => [])).resolves.toBeNull();
  });
});
