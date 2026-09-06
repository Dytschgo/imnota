// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow } from 'electron';
import {
  NativeUiDriver,
  pathIsWithin,
  safeArtifactPath,
  validateCreatedSmokeDirectory,
} from './smoke-native-driver.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const target of temporary.splice(0)) await fs.rm(target, { recursive: true, force: true });
});

describe('native smoke driver', () => {
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
});
