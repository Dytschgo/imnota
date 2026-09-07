// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import {
  NativeUiDriver,
  mapSourcePointToPromptPixel,
  pathIsWithin,
  safeArtifactPath,
  validateCreatedSmokeDirectory,
} from './smoke-native-driver.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const target of temporary.splice(0)) await fs.rm(target, { recursive: true, force: true });
});

describe('native smoke driver', () => {
  it('maps native source pixels through expanded bounds and prompt offsets', () => {
    expect(mapSourcePointToPromptPixel({ x: 1200, y: 400 }, { x: 160, y: 76 }, { x: 32, y: 80 })).toEqual({
      x: 1072,
      y: 404,
    });
  });

  it('accepts only dedicated real fixture/artifact directories and contained PNG names', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const fixture = path.join(parent, 'imnota-smoke-fixture');
    const artifacts = path.join(parent, 'imnota-verification-artifacts-test');
    await fs.mkdir(fixture);
    await fs.mkdir(artifacts);
    expect(await validateCreatedSmokeDirectory(fixture, 'fixture')).toBe(fixture);
    expect(await validateCreatedSmokeDirectory(artifacts, 'artifact')).toBe(artifacts);
    expect(safeArtifactPath(artifacts, '1280x800-workspace-dark.png')).toBe(
      path.join(artifacts, '1280x800-workspace-dark.png'),
    );
    expect(() => safeArtifactPath(artifacts, '../escape.png')).toThrow();
    expect(pathIsWithin(artifacts, artifacts)).toBe(false);
  });

  it('uses trusted webContents input events for click, drag, wheel, and keyboard actions', async () => {
    const sendInputEvent = vi.fn();
    const executeJavaScript = vi.fn(async () => ({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
      text: 'Target',
      disabled: false,
    }));
    const window = {
      webContents: {
        executeJavaScript,
        sendInputEvent,
        insertText: vi.fn(async () => {}),
      },
    } as unknown as BrowserWindow;
    const driver = new NativeUiDriver(window, 100);
    await driver.click({ text: 'Target' });
    await driver.drag({ x: 1, y: 2 }, { x: 9, y: 10 }, 2);
    await driver.wheel({ x: 5, y: 6 }, 20, -10);
    await driver.press('ENTER');

    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseDown', button: 'left', x: 60, y: 40 }),
    );
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'mouseWheel', deltaX: 20, deltaY: -10 }),
    );
    expect(sendInputEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'keyDown', keyCode: 'ENTER' }),
    );
  });

  it('sizes and verifies the renderer CSS viewport instead of the outer window frame', async () => {
    const setContentSize = vi.fn();
    const executeJavaScript = vi.fn(async () => ({ width: 1280, height: 800 }));
    const window = {
      setContentSize,
      webContents: { executeJavaScript },
    } as unknown as BrowserWindow;

    await new NativeUiDriver(window, 100).resize({ width: 1280, height: 800 });

    expect(setContentSize).toHaveBeenCalledWith(1280, 800, false);
    expect(executeJavaScript).toHaveBeenCalledWith(expect.stringContaining('window.innerWidth'), true);
  });

  it('fails a viewport matrix entry when the OS clamps its content size', async () => {
    const window = {
      setContentSize: vi.fn(),
      webContents: {
        executeJavaScript: vi.fn(async () => ({ width: 1920, height: 1040 })),
      },
    } as unknown as BrowserWindow;

    await expect(new NativeUiDriver(window, 100).resize({ width: 3440, height: 1440 })).rejects.toThrow(
      'OS clamped the requested 3440x1440 CSS viewport to 1920x1040',
    );
  });

  it('records CSS viewport, PNG pixels, and device-pixel ratio separately', async () => {
    const parent = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'imnota-driver-test-')));
    temporary.push(parent);
    const artifacts = path.join(parent, 'imnota-verification-artifacts-capture');
    await fs.mkdir(artifacts);
    const png = Buffer.from('captured-png');
    const window = {
      webContents: {
        capturePage: vi.fn(async () => ({
          isEmpty: () => false,
          toPNG: () => png,
          getSize: () => ({ width: 2560, height: 1600 }),
        })),
        executeJavaScript: vi.fn(async () => ({
          cssViewport: { width: 1280, height: 800 },
          devicePixelRatio: 2,
        })),
      },
    } as unknown as BrowserWindow;

    const capture = await new NativeUiDriver(window, 100).capture(artifacts, 'matrix.png');

    expect(capture).toEqual({
      path: path.join(artifacts, 'matrix.png'),
      cssViewport: { width: 1280, height: 800 },
      pngPixels: { width: 2560, height: 1600 },
      devicePixelRatio: 2,
    });
    expect(await fs.readFile(capture.path)).toEqual(png);
  });
});
