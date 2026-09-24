// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseMacCaptureWindows, waitForMacCaptureWindowHidden } from './macos-capture-windows.js';

const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 }];

describe('macOS capture helper boundary', () => {
  it('preserves WindowServer order, clips windows, and rejects invalid metadata', () => {
    const source = JSON.stringify([
      { id: 'window:11', title: 'Front', bounds: { x: 100, y: 100, width: 400, height: 300 } },
      { id: 'window:12', title: 'Back', bounds: { x: 1350, y: 70, width: 200, height: 300 } },
      { id: 'window:13', title: '', bounds: { x: 0, y: 0, width: 100, height: 100 } },
      { id: 'window:14', title: 'Offscreen', bounds: { x: 2000, y: 0, width: 200, height: 200 } },
      { id: 'window:15', title: 'Invalid', bounds: { x: 0, y: 0, width: -1, height: 100 } },
    ]);
    expect(parseMacCaptureWindows(source, displays)).toEqual([
      { id: 'window:11', title: 'Front', bounds: { x: 100, y: 100, width: 400, height: 300 } },
      { id: 'window:12', title: 'Back', bounds: { x: 1350, y: 70, width: 90, height: 300 } },
    ]);
  });

  it('fails closed on an oversized or malformed helper list', () => {
    expect(() => parseMacCaptureWindows('{}', displays)).toThrow('invalid');
    expect(() =>
      parseMacCaptureWindows(JSON.stringify(Array.from({ length: 81 }, () => ({}))), displays),
    ).toThrow('invalid');
  });

  it('rejects a source ID that cannot identify the hidden Imnota window', async () => {
    await expect(
      waitForMacCaptureWindowHidden(
        { packaged: true, resourcesPath: 'unused', sourcePath: 'unused' },
        'screen:1:0',
      ),
    ).rejects.toThrow('identify its window');
  });
});
